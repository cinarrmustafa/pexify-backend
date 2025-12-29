import json
import yaml
import math
import re
from typing import Any, Dict, List

# -----------------------------
# Load files
# -----------------------------
with open("payload.yaml", "r", encoding="utf-8") as f:
    payload = yaml.safe_load(f) or {}

with open("bs_rules.yaml", "r", encoding="utf-8") as f:
    rules = yaml.safe_load(f) or []

MISSING = object()

# -----------------------------
# Helpers
# -----------------------------
def to_number(x: Any):
    """
    Best-effort numeric normalization:
      - "1,000" -> 1000
      - "1000 kg" -> 1000
      - "1000yaptım" -> 1000  (yani ilk sayıyı yakalar)
      - 1000 -> 1000
    Returns float/int or None if not parseable.
    """
    if x is None or x is MISSING:
        return None
    if isinstance(x, (int, float)) and not isinstance(x, bool):
        if isinstance(x, float) and (math.isnan(x) or math.isinf(x)):
            return None
        return x
    if isinstance(x, str):
        s = x.strip()
        # remove spaces
        s = s.replace(" ", "")
        # find first number pattern (supports comma)
        m = re.search(r"-?\d[\d,]*\.?\d*", s)
        if not m:
            return None
        num_str = m.group(0).replace(",", "")
        try:
            # int if possible
            if "." in num_str:
                return float(num_str)
            return int(num_str)
        except:
            return None
    return None

def resolve_path(root: Dict[str, Any], path: str) -> Any:
    """
    Supports:
      - documents.invoice.gross_weight  (absolute)
      - invoice.gross_weight            (assumed under documents)
    Payload structure:
      payload['documents'][...]
    """
    if not path or not isinstance(path, str):
        return MISSING

    parts = path.split(".")
    if not parts:
        return MISSING

    # Choose starting root
    if parts[0] == "documents":
        val = root.get("documents", {})
        parts = parts[1:]
    else:
        # assume under documents
        val = root.get("documents", {})

    for p in parts:
        if not isinstance(val, dict) or p not in val:
            return MISSING
        val = val[p]
    return val

def check_when(rule: Dict[str, Any], payload: Dict[str, Any]) -> bool:
    """
    Your rule 'when' format:
      when:
        documents:
          - invoice
          - packing_list
    Means: payload.documents must contain these keys.
    If 'when' missing => assume True.
    """
    when = rule.get("when")
    if not when:
        return True

    docs = when.get("documents")
    if not docs:
        return True

    payload_docs = payload.get("documents", {})
    if not isinstance(payload_docs, dict):
        return False

    for doc_name in docs:
        if doc_name not in payload_docs:
            return False
    return True

def equals(a: Any, b: Any) -> bool:
    """
    Equality with numeric friendliness:
    - If both parseable as numbers => compare numerically
    - Else compare raw values
    """
    na = to_number(a)
    nb = to_number(b)
    if na is not None and nb is not None:
        return na == nb
    return a == b

def run_check(operator: str, left_val: Any, right_val: Any) -> bool:
    op = (operator or "equals").strip().lower()
    if op in ("equals", "equal", "=="):
        return equals(left_val, right_val)
    # future-proof: unknown operator => fail safe
    raise ValueError(f"Unsupported operator: {operator}")

# -----------------------------
# Engine
# -----------------------------
errors: List[Dict[str, Any]] = []

for rule in rules:
    # Skip rule if WHEN condition not met
    if not check_when(rule, payload):
        continue

    check = rule.get("check", {})
    left_path = check.get("left")
    right_path = check.get("right")
    operator = check.get("operator", "equals")

    left_val = resolve_path(payload, left_path)
    right_val = resolve_path(payload, right_path)

    # Path errors => fail but don't crash
    if left_val is MISSING or right_val is MISSING:
        errors.append({
            "rule_id": rule.get("id", "UNKNOWN_RULE"),
            "message": f"Path error (left or right not found)",
            "left_path": left_path,
            "right_path": right_path,
            "left_value": None if left_val is MISSING else left_val,
            "right_value": None if right_val is MISSING else right_val,
        })
        continue

    try:
        ok = run_check(operator, left_val, right_val)
    except Exception as e:
        errors.append({
            "rule_id": rule.get("id", "UNKNOWN_RULE"),
            "message": f"Operator error: {str(e)}",
            "left_path": left_path,
            "right_path": right_path,
            "left_value": left_val,
            "right_value": right_val,
        })
        continue

    if not ok:
        errors.append({
            "rule_id": rule.get("id", "UNKNOWN_RULE"),
            "message": rule.get("on_fail", {}).get("message", "Rule failed"),
            "left_path": left_path,
            "right_path": right_path,
            "left_value": left_val,
            "right_value": right_val,
        })

# -----------------------------
# Output: single JSON
# -----------------------------
result = {
    "status": "FAIL" if errors else "PASS",
    "errors": errors
}

print(json.dumps(result, ensure_ascii=False, indent=2))
