use tauri::{WebviewWindow, WebviewWindowBuilder};

/// Owns platform chrome while keeping window identity and geometry in the config.
pub fn create_main_window(app: &tauri::App) -> tauri::Result<WebviewWindow> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .expect("main window configuration is required");
    let builder = WebviewWindowBuilder::from_config(app, config)?;

    #[cfg(target_os = "macos")]
    let builder = builder
        .transparent(true)
        .background_color(tauri::window::Color(0, 0, 0, 0))
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .effects(
            tauri::window::EffectsBuilder::new()
                // Use the translucent HUD surface, not the thick window-background
                // material. AppKit samples and blurs the desktop behind the window.
                .effect(tauri::utils::WindowEffect::HudWindow)
                .state(tauri::utils::WindowEffectState::Active)
                .build(),
        )
        .initialization_script("window.__PRINT_SOC_NATIVE_MATERIAL__ = true;");

    builder.build()
}
