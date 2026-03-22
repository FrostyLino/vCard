use std::{fs, path::Path};

#[tauri::command]
fn read_vcf_file(path: String) -> Result<String, String> {
    validate_vcf_path(&path)?;
    fs::read_to_string(&path).map_err(|error| format!("Could not read file: {error}"))
}

#[tauri::command]
fn write_vcf_file(path: String, content: String) -> Result<(), String> {
    validate_vcf_path(&path)?;
    fs::write(&path, content).map_err(|error| format!("Could not write file: {error}"))
}

#[tauri::command]
fn list_vcf_files_in_directory(path: String) -> Result<Vec<String>, String> {
    let directory = Path::new(&path);

    if !directory.is_dir() {
        return Err("The selected path is not a directory.".into());
    }

    let mut files = fs::read_dir(directory)
        .map_err(|error| format!("Could not read directory: {error}"))?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|candidate| candidate.is_file() && is_vcf_path(candidate))
        .filter_map(|candidate| candidate.to_str().map(String::from))
        .collect::<Vec<_>>();

    files.sort();
    Ok(files)
}

fn validate_vcf_path(path: &str) -> Result<(), String> {
    let candidate = Path::new(path);
    if !is_vcf_path(candidate) {
        return Err("Only .vcf files are supported.".into());
    }

    Ok(())
}

fn is_vcf_path(candidate: &Path) -> bool {
    candidate
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("vcf"))
        .unwrap_or(false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_vcf_file,
            write_vcf_file,
            list_vcf_files_in_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
