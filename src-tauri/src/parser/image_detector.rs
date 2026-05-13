use base64::{engine::general_purpose, Engine as _};

pub(crate) fn normalize_image_string(
    value: &str,
) -> Option<(Option<String>, Option<String>, Option<String>)> {
    if value.starts_with("data:image/") && value.contains(";base64,") {
        let mime = value
            .split(';')
            .next()
            .map(|prefix| prefix.trim_start_matches("data:").to_string());
        let base64 = value
            .split_once(",")
            .map(|(_, encoded)| encoded.to_string());
        return Some((mime, Some(value.to_string()), base64));
    }

    if value.len() < 128 || value.len() > 8 * 1024 * 1024 {
        return None;
    }

    let looks_base64 = value
        .chars()
        .all(|char| char.is_ascii_alphanumeric() || matches!(char, '+' | '/' | '=' | '\n' | '\r'));
    if !looks_base64 {
        return None;
    }

    let compact = value.replace(['\n', '\r'], "");
    let sample_len = compact.len().min(4096);
    let sample = &compact[..sample_len];
    let decoded = general_purpose::STANDARD.decode(sample).ok()?;
    let kind = infer::get(&decoded)?;
    if !kind.mime_type().starts_with("image/") {
        return None;
    }

    Some((
        Some(kind.mime_type().to_string()),
        Some(format!("data:{};base64,{}", kind.mime_type(), compact)),
        Some(compact),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_data_url() {
        let image = "data:image/png;base64,abc123";
        let (mime, data_url, base64) = normalize_image_string(image).expect("image");
        assert_eq!(mime.as_deref(), Some("image/png"));
        assert_eq!(data_url.as_deref(), Some(image));
        assert_eq!(base64.as_deref(), Some("abc123"));
    }
}
