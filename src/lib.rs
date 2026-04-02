use zed_extension_api::{self as zed, LanguageServerId, Result};

struct CssIntellisenseExtension {}

impl zed::Extension for CssIntellisenseExtension {
    fn new() -> Self {
        Self {}
    }


    fn language_server_command(
        &mut self,
        _language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let settings = zed::settings::LspSettings::for_worktree("css-intellisense", worktree)
            .ok()
            .and_then(|lsp_settings| lsp_settings.settings.clone());

        // Cek custom node_path dari settings
        let node_path = settings.as_ref()
            .and_then(|s| s.get("node_path"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                worktree.which("node").ok_or_else(|| {
                    "Node.js not found in PATH. Please install Node.js to use CSS Intellisense.".to_string()
                }).unwrap_or_else(|_| "node".to_string())
            });

        // Cek custom server_path (index.js) dari settings
        let server_path = settings.as_ref()
            .and_then(|s| s.get("server_path"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "index.js".to_string());

        // Validasi hanya jika path relatif (di dalam ekstensi)
        // Kita lewati validasi jika path absolut (dimulai dengan '/' atau drive letter Windows)
        let is_absolute = server_path.starts_with('/') || 
                         (server_path.len() > 1 && server_path.as_bytes()[1] == b':' && server_path.as_bytes()[0].is_ascii_alphabetic());

        if !is_absolute {
            let full_path = std::env::current_dir()
                .unwrap()
                .join(&server_path);
            if !full_path.exists() {
                return Err(format!("Server file not found in extension: {:?}. Current dir: {:?}", server_path, std::env::current_dir().unwrap()));
            }
        }

        Ok(zed::Command {
            command: node_path,
            args: vec![server_path, "--stdio".to_string()],
            env: Default::default(),
        })
    }


    fn language_server_workspace_configuration(
        &mut self,
        _language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<Option<zed::serde_json::Value>> {
        let settings = zed::settings::LspSettings::for_worktree("css-intellisense", worktree)
            .ok()
            .and_then(|lsp_settings| lsp_settings.settings.clone())
            .unwrap_or_default();

        Ok(Some(zed::serde_json::json!({
            "cssIntellisense": settings
        })))
    }
}

zed::register_extension!(CssIntellisenseExtension);