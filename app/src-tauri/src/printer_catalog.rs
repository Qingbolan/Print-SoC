//! The desktop and agent read the same printer metadata; live queues remain authoritative.
use crate::types::*;
use serde_json::{json, Value};

fn catalogue_name(queue: &str) -> String {
    let aliases: std::collections::HashMap<String, String> =
        serde_json::from_str(include_str!("../../shared/printer-aliases.json"))
            .expect("bundled aliases");
    aliases.get(queue).cloned().unwrap_or_else(|| queue.into())
}

pub fn find(queues: &[String], filters: &Value) -> Result<Vec<Value>, String> {
    let catalogue: Vec<Value> = serde_json::from_str(include_str!("../../shared/printers.json"))
        .map_err(|e| e.to_string())?;
    let building = filters.get("building").and_then(Value::as_str);
    let paper = filters.get("paper_size").and_then(Value::as_str);
    let colour = filters
        .get("color")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let duplex = filters
        .get("duplex")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let allowed = filters
        .get("allowed_access")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_else(|| vec![json!("public")]);
    if allowed.iter().any(|v| {
        !matches!(
            v.as_str(),
            Some("public" | "staff" | "restricted" | "unknown")
        )
    }) {
        return Err("Invalid access category".into());
    }
    let mut result = Vec::new();
    for queue in queues {
        let mut printer = catalogue.iter().find(|p| p["queue_name"] == catalogue_name(queue)).cloned()
            .unwrap_or_else(|| json!({"queue_name":queue,"name":queue,"access_level":"unknown","location":null,"supports_color":null,"supports_duplex":null,"supported_paper_sizes":[]}));
        if !allowed.contains(&printer["access_level"]) {
            continue;
        }
        if building.is_some_and(|b| {
            printer["location"]["building"]
                .as_str()
                .is_none_or(|v| !v.eq_ignore_ascii_case(b))
        }) {
            continue;
        }
        if paper.is_some_and(|p| {
            !printer["supported_paper_sizes"]
                .as_array()
                .is_some_and(|sizes| sizes.contains(&json!(p)))
        }) {
            continue;
        }
        if colour && printer["supports_color"] != true {
            continue;
        }
        if duplex && printer["supports_duplex"] != true {
            continue;
        }
        printer["queue_name"] = json!(queue);
        printer["status"] = json!("Unknown");
        printer["discovered"] = json!(true);
        result.push(printer);
    }
    result.sort_by_key(|p| p["queue_name"].as_str().unwrap_or_default().to_owned());
    Ok(result)
}

pub fn validate_destination(queue: &str, settings: &PrintSettings) -> Result<(), String> {
    let catalogue: Vec<Value> = serde_json::from_str(include_str!("../../shared/printers.json"))
        .map_err(|e| e.to_string())?;
    if let Some(p) = catalogue
        .iter()
        .find(|p| p["queue_name"] == catalogue_name(queue))
    {
        if settings.color_mode == ColorMode::Color && p["supports_color"] != true {
            return Err("Selected printer does not support colour".into());
        }
        let paper = match settings.paper_size {
            PaperSize::A4 => "A4",
            PaperSize::A3 => "A3",
        };
        if !p["supported_paper_sizes"]
            .as_array()
            .is_some_and(|sizes| sizes.contains(&json!(paper)))
        {
            return Err("Selected printer does not support requested paper size".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_live_accessible_capable_queues_are_recommended() {
        let queues = vec![
            "psc111".into(),
            "psts-dx".into(),
            "cptsc".into(),
            "unknown".into(),
        ];
        let found = find(&queues, &json!({"building":"COM1","color":true})).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0]["queue_name"], "cptsc");
        let found = find(&queues, &json!({})).unwrap();
        assert!(!found
            .iter()
            .any(|p| p["queue_name"] == "psc111" || p["queue_name"] == "unknown"));
        assert!(find(&[], &json!({})).unwrap().is_empty());
    }
}
