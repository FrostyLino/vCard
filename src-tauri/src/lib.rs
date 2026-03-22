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

fn validate_vcf_path(path: &str) -> Result<(), String> {
    let candidate = Path::new(path);
    let extension = candidate
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("vcf"))
        .unwrap_or(false);

    if !extension {
        return Err("Only .vcf files are supported.".into());
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![read_vcf_file, write_vcf_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
