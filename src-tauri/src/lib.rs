use tauri::Manager;

mod pty;
mod platform;

fn create_window(app: &tauri::AppHandle, project_id: Option<String>) -> Result<String, String> {
    let window_id = format!("window-{}", uuid::Uuid::new_v4());
    let url = match project_id {
        Some(pid) => format!("index.html?project={}", pid),
        None => "index.html".to_string(),
    };

    tauri::WebviewWindowBuilder::new(
        app,
        &window_id,
        tauri::WebviewUrl::App(url.into()),
    )
    .title("Angy")
    .inner_size(1400.0, 900.0)
    .min_inner_size(800.0, 600.0)
    .decorations(true)
    .resizable(true)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(window_id)
}

#[tauri::command]
fn new_window(app: tauri::AppHandle, project_id: Option<String>) -> Result<String, String> {
    create_window(&app, project_id)
}

fn build_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

    let new_window_item = MenuItem::with_id(
        app,
        "new_window",
        "New Window",
        true,
        Some("CmdOrCtrl+N"),
    )?;

    let app_menu = Submenu::with_items(
        app,
        "Angy",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About Angy"), None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &new_window_item,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &window_menu])
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Check for --new-window flag or project argument
            let wants_new_window = argv.iter().any(|arg| arg == "--new-window");
            let project_id = argv.iter()
                .find(|arg| arg.starts_with("--project="))
                .map(|arg| arg.trim_start_matches("--project=").to_string());

            if wants_new_window || project_id.is_some() {
                let _ = create_window(app, project_id);
            } else {
                // Default: focus existing main window
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == "new_window" {
                let _ = create_window(app, None);
            }
        })
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            platform::get_platform_info,
            new_window,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows, .. } = event {
                if !has_visible_windows {
                    let _ = create_window(app, None);
                }
            }
        });
}
