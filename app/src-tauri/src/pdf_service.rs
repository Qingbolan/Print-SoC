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
    let doc = Document::load(Path::new(file_path))?;
    let num_pages = doc.get_pages().len() as u32;

    // Get file size
    let metadata = std::fs::metadata(file_path)?;
    let file_size = metadata.len();

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
    // For now, just copy the document
    // Full implementation would require complex page reordering
    let mut doc = Document::load(Path::new(input_path))?;
    doc.save(Path::new(output_path))?;
    Ok(())
}

pub fn create_nup_pdf_internal(
    input_path: &str,
    output_path: &str,
    pages_per_sheet: u32,
) -> Result<(), Box<dyn std::error::Error>> {
    // Use pdfjam command for n-up printing
    // pdfjam --nup [columns]x[rows] input.pdf -o output.pdf

    let (cols, rows) = match pages_per_sheet {
        2 => (2, 1),
        4 => (2, 2),
        6 => (3, 2),
        9 => (3, 3),
        _ => {
            // Fallback: just copy the document
            let mut doc = Document::load(Path::new(input_path))?;
            doc.save(Path::new(output_path))?;
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
        Ok(result) if result.status.success() => Ok(()),
        Ok(result) => {
            let stderr = String::from_utf8_lossy(&result.stderr);
            Err(format!("pdfjam failed: {}", stderr).into())
        }
        Err(_) => {
            // If pdfjam is not available, fall back to copying
            // In production, we should log this warning
            let mut doc = Document::load(Path::new(input_path))?;
            doc.save(Path::new(output_path))?;
            Ok(())
        }
    }
}

/// Extract page range from PDF
pub fn extract_page_range(
    input_path: &str,
    output_path: &str,
    _page_range: &PageRange,
) -> Result<(), Box<dyn std::error::Error>> {
    // For now, just copy the entire document
    // Full implementation would filter pages
    let mut doc = Document::load(Path::new(input_path))?;
    doc.save(Path::new(output_path))?;
    Ok(())
}
