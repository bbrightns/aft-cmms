import csv
import sys
import json

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

reconciled_path = r"d:\UserProfiles\Desktop\aft-cmms\backup\backup_reconciled_parts.csv"
updated_path = r"d:\UserProfiles\Desktop\aft-cmms\backup\backup_updated_info.csv"
old_path = r"d:\UserProfiles\Desktop\aft-cmms\backup\backup_correct_partid.csv"
audit_path = r"d:\UserProfiles\Desktop\aft-cmms\backup\reconciliation_audit_report.json"

def test_file(path, label):
    with open(path, mode='r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        headers = reader.fieldnames

    print(f"\n--- Testing {label} ({path}) ---")
    print(f"Total Rows: {len(rows)}")
    assert len(rows) == 779, f"Expected 779 rows, got {len(rows)}"

    ids = [r['Part ID'] for r in rows]
    unique_ids = set(ids)
    print(f"Unique Part IDs: {len(unique_ids)}")
    assert len(unique_ids) == 779, f"Duplicate Part IDs found! {len(ids) - len(unique_ids)} duplicates"

    # Verify ID format SPFL-C-XXXX
    for pid in ids:
        assert pid.startswith("SPFL-C-") and len(pid) == 11, f"Invalid ID format: {pid}"

    # Verify SPFL-C-0779 (IFM KI5023)
    r779 = [r for r in rows if r['Part ID'] == 'SPFL-C-0779']
    assert len(r779) == 1, "SPFL-C-0779 not found"
    assert 'KI5023' in r779[0]['Model'], f"Wrong model for SPFL-C-0779: {r779[0]['Model']}"
    assert 'crlxeaighpfgsduqccdg.supabase.co' in r779[0]['imageUrl'], "imageUrl missing for SPFL-C-0779"
    print("✓ SPFL-C-0779 correctly verified with Supabase image URL")

    # Verify SPFL-C-0780 (FESTO VUVG-M52)
    r780 = [r for r in rows if r['Part ID'] == 'SPFL-C-0780']
    assert len(r780) == 1, "SPFL-C-0780 not found"
    assert 'VUVG-M52' in r780[0]['Model'], f"Wrong model for SPFL-C-0780: {r780[0]['Model']}"
    print("✓ SPFL-C-0780 correctly verified as new FESTO valve")

    # Verify SPFL-C-0771 (Penny+Gilles) has image URL
    r771 = [r for r in rows if r['Part ID'] == 'SPFL-C-0771']
    assert len(r771) == 1, "SPFL-C-0771 not found"
    assert 'crlxeaighpfgsduqccdg.supabase.co' in r771[0]['imageUrl'], "imageUrl missing for SPFL-C-0771"
    print("✓ SPFL-C-0771 correctly verified with Supabase image URL")

    # Verify SPFL-C-0001 (PATLITE EHS-M1HE)
    r001 = [r for r in rows if r['Part ID'] == 'SPFL-C-0001']
    assert len(r001) == 1, "SPFL-C-0001 not found"
    assert 'PATLITE' in r001[0]['Brand'] and 'EHS-M1HE' in r001[0]['Model'], f"Wrong item for SPFL-C-0001: {r001[0]}"
    print("✓ SPFL-C-0001 correctly verified as PATLITE EHS-M1HE")

    print(f"✓ All validation assertions PASSED for {label}!")

test_file(reconciled_path, "backup_reconciled_parts.csv")
test_file(updated_path, "backup_updated_info.csv")

# Verify audit report
with open(audit_path, mode='r', encoding='utf-8') as f:
    audit_data = json.load(f)
print(f"\n--- Testing Audit Report ({audit_path}) ---")
print(f"Total audit records: {len(audit_data['audit_records'])}")
print(f"New parts provisioned: {len(audit_data['new_parts_provisioned'])}")
print(f"Retired/consolidated parts: {len(audit_data['retired_consolidated_parts'])}")
assert len(audit_data['audit_records']) == 779
assert len(audit_data['new_parts_provisioned']) == 1
assert len(audit_data['retired_consolidated_parts']) == 1
print("✓ Audit report assertions PASSED!")
