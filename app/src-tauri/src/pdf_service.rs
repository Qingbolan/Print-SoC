use crate::types::*;
use lopdf::Document;
use std::path::Path;

/// Get PDF file information
#[tauri::command]
pub fn pdf_get_info(file_path: String) -> ApiResponse<PDFInfo> {
    match get_pdf_info_internal(&file_path) {
        Ok(info) => ApiResponse::success(info),
        Err(e) => ApiResponse::error(e.to_string()),
    }
}

/// Generate booklet page order for a PDF
#[tauri::command]
pub fn pdf_generate_booklet_layout(num_pages: u32) -> ApiResponse<BookletLayout> {
    let layout = generate_booklet_layout_internal(num_pages);
    ApiResponse::success(layout)
}

/// Process PDF for booklet printing (creates new PDF with reordered pages)
#[tauri::command]
pub fn pdf_create_booklet(input_path: String, output_path: String) -> ApiResponse<String> {
    match create_booklet_pdf_internal(&input_path, &output_path) {
        Ok(_) => ApiResponse::success(format!("Booklet PDF created at {}", output_path)),
        Err(e) => ApiResponse::error(e.to_string()),
    }
}

/// Process PDF for n-up printing (multiple pages per sheet)
#[tauri::command]
pub fn pdf_create_nup(
    input_path: String,
    output_path: String,
    pages_per_sheet: u32,
) -> ApiResponse<String> {
    match create_nup_pdf_internal(&input_path, &output_path, pages_per_sheet) {
        Ok(_) => ApiResponse::success(format!("N-up PDF created at {}", output_path)),
        Err(e) => ApiResponse::error(e.to_string()),
    }
}

// ========== Internal Implementation ==========

pub(crate) fn get_pdf_info_internal(file_path: &str) -> Result<PDFInfo, Box<dyn std::error::Error>> {
    // Check if file exists first
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(format!("PDF file not found: {}", file_path).into());
    }

    // Get file size first (this always works if file exists)
    let metadata = std::fs::metadata(file_path)
        .map_err(|e| format!("Cannot read file metadata for {}: {}", file_path, e))?;
    let file_size = metadata.len();

    if file_size == 0 {
        return Err(format!("PDF file is empty: {}", file_path).into());
    }

    // Try to load with lopdf
    let doc = Document::load(path).map_err(|e| {
        format!(
            "Failed to parse PDF {}: {}. The file may be corrupted or use unsupported features.",
            file_path, e
        )
    })?;

    let num_pages = doc.get_pages().len() as u32;
    if num_pages == 0 {
        return Err(format!("PDF has no pages: {}", file_path).into());
    }

    let first_page = *doc.get_pages().values().next().ok_or("PDF has no pages")?;
    let page_size = page_dimensions(&doc, first_page)?;

    Ok(PDFInfo {
        num_pages,
        page_size,
        file_size,
    })
}

fn inherited_page_value<'a>(doc: &'a Document, mut id: lopdf::ObjectId, key: &[u8]) -> Option<&'a lopdf::Object> {
    let mut visited = std::collections::HashSet::new();
    while visited.insert(id) {
        let dict = doc.get_dictionary(id).ok()?;
        if let Ok(value) = dict.get(key) {
            return doc.dereference(value).ok().map(|(_, value)| value);
        }
        id = dict.get(b"Parent").ok()?.as_reference().ok()?;
    }
    None
}

fn page_dimensions(doc: &Document, id: lopdf::ObjectId) -> Result<(f64, f64), Box<dyn std::error::Error>> {
    let bounds = inherited_page_value(doc, id, b"CropBox")
        .or_else(|| inherited_page_value(doc, id, b"MediaBox"))
        .ok_or("PDF page has no dimensions")?.as_array()?;
    if bounds.len() != 4 { return Err("Invalid PDF page bounds".into()); }
    let width = (bounds[2].as_float()? - bounds[0].as_float()?).abs() as f64;
    let height = (bounds[3].as_float()? - bounds[1].as_float()?).abs() as f64;
    if width <= 0.0 || height <= 0.0 { return Err("Invalid PDF page size".into()); }
    let rotation = inherited_page_value(doc, id, b"Rotate").and_then(|value| value.as_i64().ok()).unwrap_or(0);
    Ok(if rotation.rem_euclid(180) == 90 { (height, width) } else { (width, height) })
}

fn generate_booklet_layout_internal(num_pages: u32) -> BookletLayout {
    // Calculate total sheets needed (4 pages per sheet in booklet mode)
    let pages_per_sheet = 4;
    let total_sheets = num_pages.div_ceil(pages_per_sheet);
    let total_pages_needed = total_sheets * pages_per_sheet;

    let mut page_order: Vec<Vec<Option<u32>>> = Vec::new();

    // Generate booklet page order
    // For a booklet, pages are arranged as:
    // Sheet 1: [n, 1, 2, n-1]
    // Sheet 2: [n-2, 3, 4, n-3]
    // etc.

    for sheet in 0..total_sheets {
        let mut sheet_pages: Vec<Option<u32>> = Vec::new();

        // Right side of sheet (when folded)
        let right_outer = total_pages_needed - (sheet * 2);
        let right_inner = sheet * 2 + 1;

        // Left side of sheet (when folded)
        let left_inner = sheet * 2 + 2;
        let left_outer = total_pages_needed - (sheet * 2) - 1;

        // Check if pages exist (not blank)
        sheet_pages.push(if right_outer <= num_pages {
            Some(right_outer)
        } else {
            None
        });
        sheet_pages.push(if right_inner <= num_pages {
            Some(right_inner)
        } else {
            None
        });
        sheet_pages.push(if left_inner <= num_pages {
            Some(left_inner)
        } else {
            None
        });
        sheet_pages.push(if left_outer <= num_pages {
            Some(left_outer)
        } else {
            None
        });

        page_order.push(sheet_pages);
    }

    BookletLayout {
        total_sheets,
        pages_per_sheet,
        page_order,
    }
}

pub fn create_booklet_pdf_internal(
    input_path: &str,
    _output_path: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    create_print_layout(input_path, _output_path, &PrintSettings {
        copies: 1, duplex: DuplexMode::DuplexShortEdge, orientation: Orientation::Landscape,
        page_range: PageRange::All, pages_per_sheet: 2, booklet: true, paper_size: PaperSize::A4,
    })
}

pub fn create_nup_pdf_internal(input_path: &str, output_path: &str, pages_per_sheet: u32) -> Result<(), Box<dyn std::error::Error>> {
    create_print_layout(input_path, output_path, &PrintSettings {
        copies: 1, duplex: DuplexMode::Simplex, orientation: Orientation::Portrait,
        page_range: PageRange::All, pages_per_sheet, booklet: false, paper_size: PaperSize::A4,
    })
}

fn layout_arguments(settings: &PrintSettings) -> Result<Vec<String>, String> {
    let grid = match if settings.booklet { 2 } else { settings.pages_per_sheet } {
        1 => "1x1", 2 => "2x1", 4 => "2x2", 6 => "3x2", 9 => "3x3",
        _ => return Err("Unsupported pages per sheet".into()),
    };
    if settings.booklet && matches!(settings.duplex, DuplexMode::Simplex) {
        return Err("Booklet printing requires two-sided printing".into());
    }
    Ok(vec![
        "--vanilla".into(), "--nup".into(), grid.into(),
        "--paper".into(), match settings.paper_size { PaperSize::A4 => "a4paper", PaperSize::A3 => "a3paper" }.into(),
        match settings.orientation { Orientation::Portrait => "--no-landscape", Orientation::Landscape => "--landscape" }.into(),
        "--delta".into(), "0pt 0pt".into(), "--offset".into(), "0pt 0pt".into(),
        "--frame".into(), "false".into(), "--scale".into(), "1".into(),
        "--noautoscale".into(), "false".into(), "--quiet".into(),
    ])
}

pub(crate) fn validate_print_settings(settings: &PrintSettings, page_count: u32) -> Result<(), String> {
    if settings.copies == 0 { return Err("At least one copy is required".into()); }
    layout_arguments(settings)?;
    selected_pages(&settings.page_range, page_count)?;
    Ok(())
}

pub fn create_print_layout(input_path: &str, output_path: &str, settings: &PrintSettings) -> Result<(), Box<dyn std::error::Error>> {
    create_print_layout_cancellable(input_path, output_path, settings, || false)
}

pub(crate) fn create_print_layout_cancellable(input_path: &str, output_path: &str, settings: &PrintSettings, cancelled: impl Fn() -> bool) -> Result<(), Box<dyn std::error::Error>> {
    let arguments = layout_arguments(settings)?;
    let count = Document::load(input_path)?.get_pages().len() as u32;
    let selected = selected_pages(&settings.page_range, count)?;
    let pages = if settings.booklet {
        generate_booklet_layout_internal(selected.len() as u32).page_order.into_iter()
            .flatten().map(|index| index.map_or_else(|| "{}".to_string(), |index| selected[index as usize - 1].to_string()))
            .collect::<Vec<_>>().join(",")
    } else {
        selected.iter().map(u32::to_string).collect::<Vec<_>>().join(",")
    };
    let mut command = std::process::Command::new("pdfjam");
    command.args(arguments).arg(input_path).arg(pages).arg("-o").arg(output_path);
    let result = crate::process_service::run(&mut command, std::time::Duration::from_secs(180), cancelled)
        .map_err(|error| format!("PDF layout requires pdfjam (TeX Live). No job was submitted: {}", error))?;
    if !result.status.success() {
        return Err(format!("PDF layout failed; no job was submitted: {}", result.diagnostic).into());
    }
    get_pdf_info_internal(output_path)?;
    Ok(())
}

fn selected_pages(range: &PageRange, count: u32) -> Result<Vec<u32>, String> {
    let mut pages = match range {
        PageRange::All if count > 0 => (1..=count).collect(),
        PageRange::Range { start, end } if *start >= 1 && end >= start && *end <= count => (*start..=*end).collect(),
        PageRange::Selection { pages } if !pages.is_empty() && pages.iter().all(|p| *p >= 1 && *p <= count) => pages.clone(),
        _ => return Err("Invalid or empty page selection".into()),
    };
    pages.sort_unstable();
    pages.dedup();
    Ok(pages)
}

#[cfg(test)]
mod preview_tests {
    use super::*;
    use lopdf::{dictionary, Object, Stream};

    fn fixture(count: u32) -> Document {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let content = doc.add_object(Stream::new(dictionary! {}, b"0 0 0 rg 0 0 1600 900 re f".to_vec()));
        let mut kids = Vec::new();
        for _ in 0..count {
            let id = doc.add_object(dictionary! {"Type" => "Page", "Parent" => pages_id, "Contents" => content, "Resources" => dictionary! {} });
            kids.push(Object::Reference(id));
        }
        doc.objects.insert(pages_id, dictionary! {"Type" => "Pages", "Kids" => kids, "Count" => count, "MediaBox" => vec![0.into(),0.into(),1600.into(),900.into()]}.into());
        let root = doc.add_object(dictionary! {"Type" => "Catalog", "Pages" => pages_id});
        doc.trailer.set("Root", root);
        doc
    }

    #[test]
    fn booklet_order_covers_each_page_once_with_blank_padding() {
        for count in 1..=101 {
            let layout = generate_booklet_layout_internal(count);
            assert_eq!(layout.total_sheets, count.div_ceil(4));
            let mut pages: Vec<u32> = layout.page_order.iter().flatten().filter_map(|p| *p).collect();
            pages.sort_unstable();
            assert_eq!(pages, (1..=count).collect::<Vec<_>>());
            for (sheet, sides) in layout.page_order.iter().enumerate() {
                assert_eq!(sides[1], Some(sheet as u32 * 2 + 1));
            }
        }
        assert_eq!(generate_booklet_layout_internal(5).page_order,
            vec![vec![None, Some(1), Some(2), None], vec![None, Some(3), Some(4), Some(5)]]);
        assert_eq!(selected_pages(&PageRange::Selection { pages: vec![5, 1, 5, 3] }, 5).unwrap(), vec![1, 3, 5]);
        assert!(selected_pages(&PageRange::Range { start: 0, end: 2 }, 5).is_err());
    }

    #[test]
    #[ignore = "requires pdfjam and TeX Live"]
    fn real_booklet_pads_to_complete_duplex_sheets() {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("five.pdf");
        let output = dir.path().join("booklet.pdf");
        fixture(5).save(&input).unwrap();
        create_booklet_pdf_internal(input.to_str().unwrap(), output.to_str().unwrap()).unwrap();
        let doc = Document::load(&output).unwrap();
        assert_eq!(doc.get_pages().len(), 4);
        for id in doc.get_pages().values() {
            let (width, height) = page_dimensions(&doc, *id).unwrap();
            assert!((width - 842.0).abs() < 1.0 && (height - 595.0).abs() < 1.0);
        }
    }

    #[test]
    #[ignore = "requires pdfjam, TeX Live and pdftoppm"]
    fn rendered_booklet_has_correct_front_back_cells_and_blanks() {
        let dir = tempfile::tempdir().unwrap();
        let mut doc = fixture(5);
        let colors = [[1,0,0], [0,1,0], [0,0,1], [1,1,0], [1,0,1]];
        for (index, page) in doc.get_pages().values().enumerate() {
            let [r,g,b] = colors[index];
            let stream = doc.add_object(Stream::new(dictionary! {}, format!("{} {} {} rg 0 0 1600 900 re f", r,g,b).into_bytes()));
            doc.get_object_mut(*page).unwrap().as_dict_mut().unwrap().set("Contents", stream);
        }
        let input = dir.path().join("colors.pdf");
        let output = dir.path().join("booklet.pdf");
        doc.save(&input).unwrap();
        create_booklet_pdf_internal(input.to_str().unwrap(), output.to_str().unwrap()).unwrap();
        let prefix = dir.path().join("side");
        let result = crate::process_service::run(
            std::process::Command::new("pdftoppm").args(["-scale-to", "600", "-png"]).arg(&output).arg(&prefix),
            std::time::Duration::from_secs(30), || false,
        ).unwrap();
        assert!(result.status.success(), "{}", result.diagnostic);
        let expected = [[[255,255,255],[255,0,0]], [[0,255,0],[255,255,255]], [[255,255,255],[0,0,255]], [[255,255,0],[255,0,255]]];
        for (side, cells) in expected.iter().enumerate() {
            let image = image::open(dir.path().join(format!("side-{}.png", side + 1))).unwrap().to_rgb8();
            for (cell, expected) in cells.iter().enumerate() {
                let pixel = image.get_pixel(image.width() * (1 + cell as u32 * 2) / 4, image.height() / 2);
                for channel in 0..3 { assert!((i32::from(pixel[channel]) - expected[channel]).abs() < 3, "side {} cell {}: {:?}", side + 1, cell, pixel); }
            }
        }
    }

    #[test]
    fn reads_inherited_dimensions_crop_and_rotation() {
        let mut doc = fixture(1);
        let id = *doc.get_pages().values().next().unwrap();
        assert_eq!(page_dimensions(&doc, id).unwrap(), (1600.0, 900.0));
        let page = doc.get_object_mut(id).unwrap().as_dict_mut().unwrap();
        page.set("CropBox", vec![0.into(), 0.into(), 1200.into(), 800.into()]);
        page.set("Rotate", 90);
        assert_eq!(page_dimensions(&doc, id).unwrap(), (800.0, 1200.0));
    }

    #[test]
    #[ignore = "requires pdfjam and TeX Live"]
    fn real_nine_up_landscape_matches_preview_sheet_geometry() {
        let dir = std::env::temp_dir().join(format!("print-layout-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let input = dir.join("slides.pdf");
        let output = dir.join("layout.pdf");
        fixture(19).save(&input).unwrap();
        let settings = PrintSettings {
            copies: 1, duplex: DuplexMode::DuplexShortEdge, orientation: Orientation::Landscape,
            page_range: PageRange::All, pages_per_sheet: 9, booklet: false, paper_size: PaperSize::A4,
        };
        let result = create_print_layout(input.to_str().unwrap(), output.to_str().unwrap(), &settings);
        if let Err(error) = result { let _ = std::fs::remove_dir_all(&dir); panic!("{}", error); }
        let doc = Document::load(&output).unwrap();
        assert_eq!(doc.get_pages().len(), 3); // two physical duplex sheets
        let size = page_dimensions(&doc, *doc.get_pages().values().next().unwrap()).unwrap();
        assert!((size.0 - 842.0).abs() < 1.0 && (size.1 - 595.0).abs() < 1.0);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
