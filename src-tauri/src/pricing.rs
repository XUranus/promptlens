use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelPricing {
    pub model: String,
    pub provider: String,
    pub input_per_mtok: f64,
    pub output_per_mtok: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostEstimate {
    pub model: String,
    pub input_cost: f64,
    pub output_cost: f64,
    pub total_cost: f64,
    pub matched_pricing: Option<String>,
}

const PRICING_JSON: &str = include_str!("../pricing.json");

static PRICING_TABLE: OnceLock<Vec<ModelPricing>> = OnceLock::new();

pub fn load_pricing_table() -> &'static [ModelPricing] {
    PRICING_TABLE.get_or_init(|| serde_json::from_str(PRICING_JSON).unwrap_or_default())
}

pub fn find_pricing<'a>(model: &str, table: &'a [ModelPricing]) -> Option<&'a ModelPricing> {
    let lower = model.to_lowercase();
    // Exact match
    if let Some(p) = table.iter().find(|p| p.model.to_lowercase() == lower) {
        return Some(p);
    }
    // Substring match (longest matching model name wins)
    let mut best: Option<(&ModelPricing, usize)> = None;
    for p in table {
        let p_lower = p.model.to_lowercase();
        if lower.contains(&p_lower) {
            let len = p_lower.len();
            if best.map_or(true, |(_, blen)| len > blen) {
                best = Some((p, len));
            }
        }
    }
    best.map(|(p, _)| p)
}

pub fn calculate_cost(
    model: &str,
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
    table: &[ModelPricing],
) -> CostEstimate {
    let pricing = find_pricing(model, table);
    let input_tokens = prompt_tokens.unwrap_or(0) as f64;
    let output_tokens = completion_tokens.unwrap_or(0) as f64;
    let (input_cost, output_cost) = match pricing {
        Some(p) => (
            (input_tokens / 1_000_000.0) * p.input_per_mtok,
            (output_tokens / 1_000_000.0) * p.output_per_mtok,
        ),
        None => (0.0, 0.0),
    };
    CostEstimate {
        model: model.to_string(),
        input_cost,
        output_cost,
        total_cost: input_cost + output_cost,
        matched_pricing: pricing.map(|p| p.model.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_pricing_table() {
        let table = load_pricing_table();
        assert!(table.len() >= 15);
        assert!(table.iter().any(|p| p.model == "gpt-4o"));
        assert!(table.iter().any(|p| p.model == "claude-sonnet-4"));
    }

    #[test]
    fn exact_model_match() {
        let table = load_pricing_table();
        let p = find_pricing("gpt-4o", &table).unwrap();
        assert_eq!(p.model, "gpt-4o");
    }

    #[test]
    fn fuzzy_model_match() {
        let table = load_pricing_table();
        let p = find_pricing("gpt-4o-2024-08-06", &table).unwrap();
        assert_eq!(p.model, "gpt-4o");
    }

    #[test]
    fn unknown_model_returns_zero() {
        let table = load_pricing_table();
        let cost = calculate_cost("unknown-model-xyz", Some(1000), Some(500), &table);
        assert_eq!(cost.total_cost, 0.0);
        assert!(cost.matched_pricing.is_none());
    }

    #[test]
    fn cost_calculation() {
        let table = load_pricing_table();
        let cost = calculate_cost("gpt-4o", Some(1_000_000), Some(1_000_000), &table);
        assert!((cost.input_cost - 2.50).abs() < 0.01);
        assert!((cost.output_cost - 10.00).abs() < 0.01);
        assert!((cost.total_cost - 12.50).abs() < 0.01);
    }
}
