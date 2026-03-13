use serde::Serialize;
use tauri::command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    pub os: String,
    pub default_shell: String,
    pub angy_config_dir: String,
}

#[command]
pub fn get_platform_info() -> Result<PlatformInfo, String> {
    let os = std::env::consts::OS.to_string(); // "linux", "macos", "windows"

    let default_shell = std::env::var("SHELL")
        .unwrap_or_else(|_| "/bin/bash".to_string());

    let home = std::env::var("HOME")
        .map_err(|_| "HOME not set".to_string())?;

    let angy_config_dir = if os == "linux" {
        let xdg_config = std::env::var("XDG_CONFIG_HOME")
            .unwrap_or_else(|_| format!("{}/.config", home));
        format!("{}/angy", xdg_config)
    } else {
        format!("{}/.angy", home)
    };

    Ok(PlatformInfo { os, default_shell, angy_config_dir })
}
