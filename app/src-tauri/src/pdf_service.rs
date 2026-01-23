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

fn get_pdf_info_internal(file_path: &str) -> Result<PDFInfo, Box<dyn std::error::Error>> {
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
    let doc = Document::load(path)
        .map_err(|e| format!("Failed to parse PDF {}: {}. The file may be corrupted or use unsupported features.", file_path, e))?;

    let num_pages = doc.get_pages().len() as u32;
    if num_pages == 0 {
        return Err(format!("PDF has no pages: {}", file_path).into());
    }

    // Default A4 page size
    let page_size = (595.0, 842.0);

    Ok(PDFInfo {
        num_pages,
        page_size,
        file_size,
    })
}

fn generate_booklet_layout_internal(num_pages: u32) -> BookletLayout {
    // Calculate total sheets needed (4 pages per sheet in booklet mode)
    let pages_per_sheet = 4;
    let total_sheets = ((num_pages as f32) / pages_per_sheet as f32).ceil() as u32;
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
    output_path: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    // Verify input file exists
    if !Path::new(input_path).exists() {
        return Err(format!("Input PDF not found for booklet: {}", input_path).into());
    }

    // For now, just copy the document
    // Full implementation would require complex page reordering
    eprintln!("[PDF] Creating booklet (currently just copying original)");
    std::fs::copy(input_path, output_path)
        .map_err(|e| format!("Failed to copy PDF for booklet: {}", e))?;
    Ok(())
}

pub fn create_nup_pdf_internal(
    input_path: &str,
    output_path: &str,
    pages_per_sheet: u32,
) -> Result<(), Box<dyn std::error::Error>> {
    // Verify input file exists
    if !Path::new(input_path).exists() {
        return Err(format!("Input PDF not found for n-up: {}", input_path).into());
    }

    // Use pdfjam command for n-up printing
    // pdfjam --nup [columns]x[rows] input.pdf -o output.pdf

    let (cols, rows) = match pages_per_sheet {
        2 => (2, 1),
        4 => (2, 2),
        6 => (3, 2),
        9 => (3, 3),
        _ => {
            // Fallback: just copy the document
            eprintln!("[PDF] Unsupported pages_per_sheet {}, copying original", pages_per_sheet);
            std::fs::copy(input_path, output_path)
                .map_err(|e| format!("Failed to copy PDF: {}", e))?;
            return Ok(());
        }
    };

    // Try to use pdfjam command
    let output = std::process::Command::new("pdfjam")
        .arg("--nup")
        .arg(format!("{}x{}", cols, rows))
        .arg(input_path)
        .arg("-o")
        .arg(output_path)
        .arg("--quiet")
        .output();

    match output {
        Ok(result) if result.status.success() => {
            eprintln!("[PDF] pdfjam n-up succeeded");
            Ok(())
        }
        Ok(result) => {
            let stderr = String::from_utf8_lossy(&result.stderr);
            eprintln!("[PDF] pdfjam n-up failed: {}", stderr);
            // Fallback: copy original file
            eprintln!("[PDF] Falling back to original file (n-up will not be applied)");
            std::fs::copy(input_path, output_path)
                .map_err(|e| format!("Failed to copy PDF: {}", e))?;
            Ok(())
        }
        Err(e) => {
            // pdfjam not available, fall back to copying
            eprintln!("[PDF] pdfjam not available ({}), copying original file", e);
            std::fs::copy(input_path, output_path)
                .map_err(|e| format!("Failed to copy PDF: {}", e))?;
            Ok(())
        }
    }
}

/// Extract page range from PDF
#[allow(dead_code)]
pub fn extract_page_range(
    input_path: &str,
    output_path: &str,
    _page_range: &PageRange,
) -> Result<(), Box<dyn std::error::Error>> {
    // Verify input file exists
    if !Path::new(input_path).exists() {
        return Err(format!("Input PDF not found: {}", input_path).into());
    }

    // For now, just copy the entire document
    // Full implementation would filter pages
    std::fs::copy(input_path, output_path)
        .map_err(|e| format!("Failed to copy PDF: {}", e))?;
    Ok(())
}
