//! Normalize supported source documents to a validated PDF shared by preview and printing.
use crate::{
    pdf_service::get_pdf_info_internal,
    storage_service::get_app_data_dir,
    types::{ApiResponse, PDFInfo},
};
#[cfg(test)]
use std::process::Command;
use image::ImageDecoder;
use lopdf::{dictionary, Document, Stream};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};

const IMAGES: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp"];
const OFFICE: &[&str] = &[
    "doc", "docx", "odt", "ppt", "pptx", "odp", "xls", "xlsx", "ods", "rtf", "txt", "csv",
];
const MAX_SOURCE_BYTES: u64 = 128 * 1024 * 1024;

#[derive(Serialize)]
pub struct PreparedDocument {
    path: String,
    name: String,
    info: PDFInfo,
}

#[tauri::command]
pub fn document_extensions() -> ApiResponse<Vec<String>> {
    ApiResponse::success(std::iter::once("pdf")
        .chain(IMAGES.iter().copied())
        .chain(OFFICE.iter().copied())
        .map(str::to_owned)
        .collect())
}

#[cfg(test)]
mod picker_contract_tests {
    #[test]
    fn formats_use_the_same_response_contract_as_document_preparation() {
        let response = serde_json::to_value(super::document_extensions()).unwrap();
        assert_eq!(response["success"], true);
        let formats = response["data"].as_array().unwrap();
        for extension in ["pdf", "pptx", "jpg", "png"] {
            assert!(formats.iter().any(|value| value == extension));
        }
        assert!(formats.iter().all(|value| value.as_str().is_some_and(|s| !s.starts_with('.'))));
    }
}

#[tauri::command]
pub async fn document_prepare(file_path: String) -> ApiResponse<PreparedDocument> {
    match tauri::async_runtime::spawn_blocking(move || prepare(Path::new(&file_path))).await {
        Ok(Ok(document)) => ApiResponse::success(document),
        Ok(Err(error)) => ApiResponse::error(error),
        Err(_) => ApiResponse::error("Document conversion failed".into()),
    }
}

fn prepare(source: &Path) -> Result<PreparedDocument, String> {
    let cache = get_app_data_dir()
        .ok_or("Application data directory unavailable")?
        .join("imports");
    prepare_in(source, &cache)
}

fn prepare_in(source: &Path, cache: &Path) -> Result<PreparedDocument, String> {
    let source = fs::canonicalize(source).map_err(|_| "Source file not found".to_string())?;
    let metadata = source.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("Choose a file, not a folder".into());
    }
    let extension = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let name = source.file_name().unwrap().to_string_lossy().to_string();
    if extension != "pdf" && !IMAGES.contains(&extension.as_str()) && !OFFICE.contains(&extension.as_str()) {
        return Err("Unsupported format. Choose PDF, PNG/JPEG/WebP/BMP, or an Office/text document. For other formats, use the original app’s Print → Save as PDF.".into());
    }
    if extension != "pdf" && metadata.len() > MAX_SOURCE_BYTES {
        return Err("Conversion supports source files up to 128 MB".into());
    }
    fs::create_dir_all(cache).map_err(|e| e.to_string())?;
    let work = tempfile::tempdir_in(cache).map_err(|e| e.to_string())?;
    let snapshot = work.path().join(format!("source.{}", extension));
    let mut snapshot_file = fs::File::create(&snapshot).map_err(|e| e.to_string())?;
    let mut total = 0u64;
    let mut hash = Sha256::new();
    hash.update(b"document-converter-v1");
    hash.update(extension.as_bytes());
    let mut file = fs::File::open(&source).map_err(|e| e.to_string())?;
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        total += count as u64;
        if extension != "pdf" && total > MAX_SOURCE_BYTES {
            return Err("Conversion supports source files up to 128 MB".into());
        }
        snapshot_file
            .write_all(&buffer[..count])
            .map_err(|e| e.to_string())?;
        hash.update(&buffer[..count]);
    }
    drop(snapshot_file);
    let output = cache.join(format!("{:x}.pdf", hash.finalize()));
    if let Ok(document) = prepared(&output, name.clone()) { return Ok(document); }
    let converted = work.path().join("document.pdf");
    if extension == "pdf" {
        fs::rename(&snapshot, &converted).map_err(|e| e.to_string())?;
    } else if IMAGES.contains(&extension.as_str()) {
        image_to_pdf(&snapshot, &converted)?;
    } else {
        office_to_pdf(&snapshot, &converted, work.path())?;
    }
    // Never expose partial or invalid output to preview or the print queue.
    prepared(&converted, name.clone())?;
    // Atomic replacement keeps the old inode readable until a fully validated
    // replacement is published. No delete-then-create window for other readers.
    if let Err(error) = fs::rename(&converted, &output) {
        // Another importer may have published the same content first, or a
        // platform may prevent replacing a file currently opened for preview.
        if let Ok(document) = prepared(&output, name.clone()) { return Ok(document); }
        return Err(format!("Could not publish converted PDF: {}", error));
    }
    prepared(&output, name)
}

fn prepared(path: &Path, name: String) -> Result<PreparedDocument, String> {
    let path = path.to_str().ok_or("Unsupported file path encoding")?;
    let info = get_pdf_info_internal(path).map_err(|e| e.to_string())?;
    Ok(PreparedDocument {
        path: path.into(),
        name,
        info,
    })
}

fn image_to_pdf(source: &Path, output: &Path) -> Result<(), String> {
    let reader = image::ImageReader::open(source)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    match reader.format() {
        Some(image::ImageFormat::Png) => {
            let decoder = image::codecs::png::PngDecoder::new(std::io::BufReader::new(
                fs::File::open(source).map_err(|e| e.to_string())?,
            ))
            .map_err(|e| e.to_string())?;
            if decoder.is_apng().map_err(|e| e.to_string())? {
                return Err(
                    "Animated PNG is not supported. Export the desired frame as a static image."
                        .into(),
                );
            }
        }
        Some(image::ImageFormat::WebP) => {
            let decoder = image::codecs::webp::WebPDecoder::new(std::io::BufReader::new(
                fs::File::open(source).map_err(|e| e.to_string())?,
            ))
            .map_err(|e| e.to_string())?;
            if decoder.has_animation() {
                return Err(
                    "Animated WebP is not supported. Export the desired frame as a static image."
                        .into(),
                );
            }
        }
        _ => {}
    }
    let mut decoder = reader.into_decoder().map_err(|e| e.to_string())?;
    let (width, height) = decoder.dimensions();
    if u64::from(width) * u64::from(height) > 40_000_000 {
        return Err("Images must be at most 40 megapixels".into());
    }
    let orientation = decoder.orientation().map_err(|e| e.to_string())?;
    let mut bitmap = image::DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
    bitmap.apply_orientation(orientation);
    let rgba = bitmap.to_rgba8();
    let (width, height) = rgba.dimensions();
    // Composite transparency onto paper white; retain full resolution in a lossless PDF image.
    let mut rgb = Vec::with_capacity(width as usize * height as usize * 3);
    for pixel in rgba.pixels() {
        let alpha = u32::from(pixel[3]);
        for channel in &pixel.0[..3] {
            rgb.push(((u32::from(*channel) * alpha + 255 * (255 - alpha) + 127) / 255) as u8);
        }
    }
    let mut doc = Document::with_version("1.5");
    let image = doc.add_object(Stream::new(
        dictionary! {
            "Type" => "XObject", "Subtype" => "Image", "Width" => width, "Height" => height,
            "ColorSpace" => "DeviceRGB", "BitsPerComponent" => 8,
        },
        rgb,
    ));
    // A proportional source page, fitted to the user's chosen paper by the shared print pipeline.
    let page_width = 720.0_f32;
    let page_height = page_width * height as f32 / width as f32;
    let content = doc.add_object(Stream::new(
        dictionary! {},
        format!("q {} 0 0 {} 0 0 cm /Image Do Q", page_width, page_height).into_bytes(),
    ));
    let pages = doc.new_object_id();
    let page = doc.add_object(dictionary! {
        "Type" => "Page", "Parent" => pages, "Contents" => content,
        "MediaBox" => vec![0.into(), 0.into(), page_width.into(), page_height.into()],
        "Resources" => dictionary! {"XObject" => dictionary! {"Image" => image}},
    });
    doc.objects.insert(
        pages,
        dictionary! {"Type" => "Pages", "Kids" => vec![page.into()], "Count" => 1}.into(),
    );
    let catalog = doc.add_object(dictionary! {"Type" => "Catalog", "Pages" => pages});
    doc.trailer.set("Root", catalog);
    doc.compress();
    doc.save(output).map_err(|e| e.to_string())?;
    Ok(())
}

fn office_binary() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        let app = PathBuf::from("/Applications/LibreOffice.app/Contents/MacOS/soffice");
        if app.exists() {
            return app;
        }
    }
    #[cfg(target_os = "windows")]
    for variable in ["PROGRAMFILES", "PROGRAMFILES(X86)"] {
        if let Some(root) = std::env::var_os(variable) {
            let app = PathBuf::from(root).join("LibreOffice/program/soffice.exe");
            if app.exists() {
                return app;
            }
        }
    }
    PathBuf::from("soffice")
}

fn office_to_pdf(source: &Path, output: &Path, work: &Path) -> Result<(), String> {
    let profile = work.join("profile");
    fs::create_dir_all(profile.join("user")).map_err(|e| e.to_string())?;
    fs::write(profile.join("user/registrymodifications.xcu"), r#"<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>"#).map_err(|e| e.to_string())?;
    let profile_url =
        url::Url::from_directory_path(&profile).map_err(|_| "Invalid conversion profile path")?;
    // A private profile avoids interfering with open LibreOffice documents.
    let binary = office_binary();
    let mut command = crate::process_service::converter_command(&binary.to_string_lossy());
    command.arg(format!("-env:UserInstallation={}", profile_url))
        .args(["--headless", "--nologo", "--nodefault", "--norestore", "--convert-to", "pdf", "--outdir"])
        .arg(work).arg(source);
    let result = crate::process_service::run(&mut command, Duration::from_secs(90), || false)
        .map_err(|error| format!("Office conversion requires LibreOffice: {}", error))?;
    if !result.status.success() {
        return Err(format!("LibreOffice could not convert this document: {}", result.diagnostic));
    }
    let generated = work
        .join(source.file_stem().ok_or("Missing filename")?)
        .with_extension("pdf");
    if !generated.exists() {
        return Err("Document could not be converted. It may be encrypted or unsupported; export it to PDF in its original application.".into());
    }
    if generated != output {
        fs::rename(generated, output).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn static_images_share_a_valid_pdf_pipeline_and_cache() {
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("imports");
        for ext in ["png", "jpg", "webp", "bmp"] {
            let source = dir.path().join(format!("test.{}", ext));
            let bitmap = image::RgbImage::from_pixel(160, 90, image::Rgb([25, 100, 220]));
            bitmap.save(&source).unwrap();
            let first = prepare_in(&source, &cache).unwrap();
            assert_eq!(first.info.num_pages, 1);
            assert!((first.info.page_size.0 / first.info.page_size.1 - 16.0 / 9.0).abs() < 0.001);
            assert_eq!(first.name, format!("test.{}", ext));
            assert_eq!(prepare_in(&source, &cache).unwrap().path, first.path);
        }
    }

    #[test]
    fn pdf_import_is_a_durable_snapshot_and_damaged_cache_is_rebuilt() {
        let dir = tempfile::tempdir().unwrap();
        let image = dir.path().join("source.png");
        image::RgbImage::from_pixel(10, 10, image::Rgb([0, 0, 0])).save(&image).unwrap();
        let source = dir.path().join("source.pdf");
        image_to_pdf(&image, &source).unwrap();
        let cache = dir.path().join("imports");
        let imported = prepare_in(&source, &cache).unwrap();
        assert_ne!(Path::new(&imported.path), source);
        fs::write(&imported.path, "corrupt").unwrap();
        assert_eq!(prepare_in(&source, &cache).unwrap().path, imported.path);
        fs::remove_file(&source).unwrap();
        assert_eq!(get_pdf_info_internal(&imported.path).unwrap().num_pages, 1);
    }

    #[test]
    fn concurrent_imports_publish_one_valid_cache_entry() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.png");
        image::RgbImage::from_pixel(500, 400, image::Rgb([20, 50, 100])).save(&source).unwrap();
        let cache = dir.path().join("imports");
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(4));
        let handles: Vec<_> = (0..4).map(|_| {
            let (source, cache, barrier) = (source.clone(), cache.clone(), barrier.clone());
            std::thread::spawn(move || { barrier.wait(); prepare_in(&source, &cache).unwrap().path })
        }).collect();
        let outputs: Vec<_> = handles.into_iter().map(|handle| handle.join().unwrap()).collect();
        assert!(outputs.iter().all(|path| path == &outputs[0]));
        assert_eq!(get_pdf_info_internal(&outputs[0]).unwrap().num_pages, 1);
        assert_eq!(fs::read_dir(cache).unwrap().count(), 1);
    }

    #[test]
    fn transparent_pixels_are_printed_on_white_and_invalid_files_fail() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("transparent.png");
        image::RgbaImage::from_pixel(1, 1, image::Rgba([0, 0, 0, 0]))
            .save(&source)
            .unwrap();
        let output = dir.path().join("image.pdf");
        image_to_pdf(&source, &output).unwrap();
        let doc = Document::load(output).unwrap();
        let stream = doc
            .objects
            .values()
            .filter_map(|o| o.as_stream().ok())
            .find(|s| s.dict.get(b"Subtype").ok().and_then(|v| v.as_name().ok()) == Some(b"Image"))
            .unwrap();
        let pixels = stream
            .decompressed_content()
            .unwrap_or_else(|_| stream.content.clone());
        assert_eq!(pixels, vec![255, 255, 255]);
        let invalid = dir.path().join("bad.png");
        fs::write(&invalid, "not an image").unwrap();
        assert!(prepare_in(&invalid, &dir.path().join("cache")).is_err());
        let unknown = dir.path().join("program.exe");
        fs::write(&unknown, "not printable").unwrap();
        assert!(prepare_in(&unknown, &dir.path().join("cache")).is_err());
    }

    #[test]
    #[ignore = "requires LibreOffice and pdftotext"]
    fn office_format_matrix_retains_document_content() {
        let dir = tempfile::tempdir().unwrap();
        let text = dir.path().join("writer.txt");
        fs::write(&text, "PrintSoCWriterMarker\nSecond line").unwrap();
        let sheet = dir.path().join("calc.csv");
        fs::write(&sheet, "PrintSoCCalcMarker,Count\nPaper,2").unwrap();
        let slides = dir.path().join("slides.fodp");
        fs::write(&slides, r#"<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.presentation">
<office:body><office:presentation><draw:page draw:name="Slide1"><draw:frame svg:x="1cm" svg:y="1cm" svg:width="20cm" svg:height="4cm"><draw:text-box><text:p>PrintSoCImpressMarker</text:p></draw:text-box></draw:frame></draw:page></office:presentation></office:body></office:document>"#).unwrap();
        for (source, formats, marker) in [
            (&text, vec!["doc", "docx", "odt", "rtf"], "PrintSoCWriterMarker"),
            (&sheet, vec!["xls", "xlsx", "ods"], "PrintSoCCalcMarker"),
            (&slides, vec!["ppt", "pptx", "odp"], "PrintSoCImpressMarker"),
        ] {
            for format in formats {
                let work = tempfile::tempdir_in(dir.path()).unwrap();
                let profile = work.path().join("profile");
                fs::create_dir(&profile).unwrap();
                let profile_url = url::Url::from_directory_path(&profile).unwrap();
                let result = crate::process_service::run(
                    Command::new(office_binary()).arg(format!("-env:UserInstallation={}", profile_url))
                        .args(["--headless", "--convert-to", format, "--outdir"]).arg(work.path()).arg(source),
                    Duration::from_secs(90), || false,
                ).unwrap();
                assert!(result.status.success(), "{}: {}", format, result.diagnostic);
                let converted = work.path().join(source.file_stem().unwrap()).with_extension(format);
                assert!(converted.is_file(), "LibreOffice fixture export failed for {}", format);
                let prepared = prepare_in(&converted, &dir.path().join("cache")).unwrap();
                let extracted = work.path().join("extracted.txt");
                let result = crate::process_service::run(Command::new("pdftotext").arg(&prepared.path).arg(&extracted), Duration::from_secs(30), || false).unwrap();
                assert!(result.status.success());
                assert!(fs::read_to_string(extracted).unwrap().contains(marker), "{} lost document content", format);
            }
        }
    }

    #[test]
    #[ignore = "requires LibreOffice"]
    fn office_text_and_spreadsheet_conversion_produces_real_pdf() {
        let dir = tempfile::tempdir().unwrap();
        for (name, content) in [
            ("unicode.txt", "Print test\n中文测试\nSecond line"),
            ("table.csv", "Name,Count\nPaper,2\nImages,3\n"),
            ("sample.rtf", r"{\rtf1\ansi Print test\par Second line}"),
        ] {
            let source = dir.path().join(name);
            fs::write(&source, content).unwrap();
            let prepared = prepare_in(&source, &dir.path().join("cache")).unwrap();
            assert!(prepared.info.num_pages >= 1);
            assert!(prepared.info.file_size > 100);
            assert_eq!(prepared.name, name);
        }
    }
}
