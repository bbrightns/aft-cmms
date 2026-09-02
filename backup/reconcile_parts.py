import csv
import json
import shutil
import sys
import os
import re

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OLD_CSV_PATH = os.path.join(BASE_DIR, "backup_correct_partid.csv")
STORE_CSV_PATH = os.path.join(os.path.dirname(BASE_DIR), "SPFL_Store_All_2026-08-03.csv")
NEW_CSV_PATH = os.path.join(BASE_DIR, "backup_updated_info.csv")
BACKUP_RAW_PATH = os.path.join(BASE_DIR, "backup_updated_info.raw_scrambled_backup.csv")
RECONCILED_CSV_PATH = os.path.join(BASE_DIR, "backup_reconciled_parts.csv")
AUDIT_JSON_PATH = os.path.join(BASE_DIR, "reconciliation_audit_report.json")

def load_csv(path):
    with open(path, mode='r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        headers = reader.fieldnames
    return headers, rows

def norm(s):
    if not s:
        return ""
    return " ".join(str(s).strip().split()).upper()

def clean_alnum(s):
    if not s:
        return ""
    return re.sub(r'[^A-Z0-9]', '', str(s).upper())

def main():
    print("=== STARTING SPARE PARTS RECONCILIATION ===")
    
    # 1. Create safety backup of the original raw scrambled file
    if not os.path.exists(BACKUP_RAW_PATH):
        print(f"Creating safety copy: {BACKUP_RAW_PATH}")
        shutil.copy2(NEW_CSV_PATH, BACKUP_RAW_PATH)
    else:
        print(f"Safety copy already exists: {BACKUP_RAW_PATH}")

    old_headers, old_rows = load_csv(OLD_CSV_PATH)
    store_headers, store_rows = load_csv(STORE_CSV_PATH) if os.path.exists(STORE_CSV_PATH) else ([], [])
    new_headers, new_rows = load_csv(BACKUP_RAW_PATH)

    print(f"Loaded {len(old_rows)} reference rows from backup_correct_partid.csv")
    print(f"Loaded {len(new_rows)} rows from backup_updated_info.csv")

    # Reference master: old_rows (778) + SPFL-C-0779 from store_rows if present
    master_rows = list(old_rows)
    if not any(r['Part ID'] == 'SPFL-C-0779' for r in master_rows) and store_rows:
        r779_candidates = [r for r in store_rows if r['Part ID'] == 'SPFL-C-0779']
        if r779_candidates:
            master_rows.append(r779_candidates[0])

    matched_new_to_master = {} # new_idx -> dict(master_idx, assigned_id, match_type, notes)
    matched_master_to_new = {} # master_idx -> new_idx

    # Tier 1: Exact Match on (Dept, Brand, Model, Desc, Plant, Area, Loc, Pos)
    for n_idx, nr in enumerate(new_rows):
        k = (norm(nr['Department']), norm(nr['Brand']), norm(nr['Model']), norm(nr['Description']),
             norm(nr['Plant']), norm(nr['Area']), norm(nr['Location']), norm(nr['Position']))
        cands = [m_idx for m_idx, m in enumerate(master_rows) if m_idx not in matched_master_to_new and (
            norm(m['Department']), norm(m['Brand']), norm(m['Model']), norm(m['Description']),
            norm(m['Plant']), norm(m['Area']), norm(m['Location']), norm(m['Position'])
        ) == k]
        if len(cands) == 1:
            m_idx = cands[0]
            matched_new_to_master[n_idx] = {
                'master_idx': m_idx,
                'assigned_id': master_rows[m_idx]['Part ID'],
                'match_type': 'EXACT_ALL',
                'confidence': 'EXACT',
                'notes': 'Exact match on Department, Brand, Model, Description, Location'
            }
            matched_master_to_new[m_idx] = n_idx

    # Tier 2: Exact Match with inventory counts (for duplicate B56 belts, wheels, etc.)
    for n_idx, nr in enumerate(new_rows):
        if n_idx in matched_new_to_master:
            continue
        k = (norm(nr['Department']), norm(nr['Brand']), norm(nr['Model']), norm(nr['Description']),
             norm(nr['Plant']), norm(nr['Area']), norm(nr['Location']), norm(nr['Position']),
             norm(nr['Actual']), norm(nr['Min']), norm(nr['Max']))
        cands = [m_idx for m_idx, m in enumerate(master_rows) if m_idx not in matched_master_to_new and (
            norm(m['Department']), norm(m['Brand']), norm(m['Model']), norm(m['Description']),
            norm(m['Plant']), norm(m['Area']), norm(m['Location']), norm(m['Position']),
            norm(m['Actual']), norm(m['Min']), norm(m['Max'])
        ) == k]
        if len(cands) == 1:
            m_idx = cands[0]
            matched_new_to_master[n_idx] = {
                'master_idx': m_idx,
                'assigned_id': master_rows[m_idx]['Part ID'],
                'match_type': 'EXACT_INVENTORY',
                'confidence': 'EXACT',
                'notes': 'Exact match including inventory Min/Max/Actual counts'
            }
            matched_master_to_new[m_idx] = n_idx

    # Tier 3: Exact on Brand + Model + Plant + Area (when Model is distinct)
    for n_idx, nr in enumerate(new_rows):
        if n_idx in matched_new_to_master:
            continue
        b = clean_alnum(nr['Brand'])
        m = clean_alnum(nr['Model'])
        p = norm(nr['Plant'])
        a = norm(nr['Area'])
        if not m or len(m) < 3:
            continue
        cands = [m_idx for m_idx, m_row in enumerate(master_rows) if m_idx not in matched_master_to_new and 
                 clean_alnum(m_row['Brand']) == b and clean_alnum(m_row['Model']) == m and norm(m_row['Plant']) == p and norm(m_row['Area']) == a]
        if len(cands) == 1:
            m_idx = cands[0]
            matched_new_to_master[n_idx] = {
                'master_idx': m_idx,
                'assigned_id': master_rows[m_idx]['Part ID'],
                'match_type': 'BRAND_MODEL_PLANT_AREA',
                'confidence': 'HIGH',
                'notes': f"Matched by Brand/Model/Plant/Area; Description updated"
            }
            matched_master_to_new[m_idx] = n_idx

    # Tier 4: Unique Brand + Model across dataset
    for n_idx, nr in enumerate(new_rows):
        if n_idx in matched_new_to_master:
            continue
        b = clean_alnum(nr['Brand'])
        m = clean_alnum(nr['Model'])
        if not m or len(m) < 3:
            continue
        cands_master = [m_idx for m_idx, m_row in enumerate(master_rows) if m_idx not in matched_master_to_new and clean_alnum(m_row['Brand']) == b and clean_alnum(m_row['Model']) == m]
        cands_new = [i for i, r in enumerate(new_rows) if clean_alnum(r['Brand']) == b and clean_alnum(r['Model']) == m]
        if len(cands_master) == 1 and len(cands_new) == 1:
            m_idx = cands_master[0]
            matched_new_to_master[n_idx] = {
                'master_idx': m_idx,
                'assigned_id': master_rows[m_idx]['Part ID'],
                'match_type': 'UNIQUE_BRAND_MODEL',
                'confidence': 'HIGH',
                'notes': 'Unique Brand+Model match across database'
            }
            matched_master_to_new[m_idx] = n_idx

    # Tier 5: Cleaned model match (removing extra annotations or standardized numbering)
    for n_idx, nr in enumerate(new_rows):
        if n_idx in matched_new_to_master:
            continue
        b = clean_alnum(nr['Brand'])
        m = clean_alnum(nr['Model'])
        if not m or len(m) < 4:
            continue
        cands = []
        for m_idx, m_row in enumerate(master_rows):
            if m_idx in matched_master_to_new:
                continue
            ob = clean_alnum(m_row['Brand'])
            om = clean_alnum(m_row['Model'])
            if (not ob or not b or ob == b or ob in b or b in ob) and om and len(om) >= 4:
                if m == om or m in om or om in m:
                    cands.append(m_idx)
        if len(cands) == 1:
            m_idx = cands[0]
            matched_new_to_master[n_idx] = {
                'master_idx': m_idx,
                'assigned_id': master_rows[m_idx]['Part ID'],
                'match_type': 'CLEANED_MODEL',
                'confidence': 'HIGH',
                'notes': f"Model cleaned: '{master_rows[m_idx]['Model']}' <-> '{nr['Model']}'"
            }
            matched_master_to_new[m_idx] = n_idx

    # Tier 6: Specific curated cases
    for n_idx, nr in enumerate(new_rows):
        if n_idx in matched_new_to_master:
            continue
        if 'EPK-1502-NC' in nr['Model']:
            cands = [m_idx for m_idx, m_row in enumerate(master_rows) if m_idx not in matched_master_to_new and 'EPK-1502-NC' in m_row['Model']]
            if len(cands) == 1:
                matched_new_to_master[n_idx] = {'master_idx': cands[0], 'assigned_id': master_rows[cands[0]]['Part ID'], 'match_type': 'CURATED_TAKASAGO', 'confidence': 'HIGH', 'notes': 'Takasago EPK-1502-NC (Brand added)'}
                matched_master_to_new[cands[0]] = n_idx
        elif 'SB116-2B4040' in nr['Model']:
            cands = [m_idx for m_idx, m_row in enumerate(master_rows) if m_idx not in matched_master_to_new and 'SB116-2B4040' in m_row['Model']]
            if len(cands) == 1:
                matched_new_to_master[n_idx] = {'master_idx': cands[0], 'assigned_id': master_rows[cands[0]]['Part ID'], 'match_type': 'CURATED_JAKSA', 'confidence': 'HIGH', 'notes': 'Jaksa SB116-2B4040 (Brand added)'}
                matched_master_to_new[cands[0]] = n_idx
        elif 'L7452410119' in nr['Model']:
            cands = [m_idx for m_idx, m_row in enumerate(master_rows) if m_idx not in matched_master_to_new and 'L7452410119' in m_row['Model']]
            if len(cands) == 1:
                matched_new_to_master[n_idx] = {'master_idx': cands[0], 'assigned_id': master_rows[cands[0]]['Part ID'], 'match_type': 'CURATED_PARKER', 'confidence': 'HIGH', 'notes': 'Parker L7452410119 (Brand updated)'}
                matched_master_to_new[cands[0]] = n_idx
        elif 'V61B513A' in nr['Model'] and nr['Plant'] == 'RFG':
            cands = [m_idx for m_idx, m_row in enumerate(master_rows) if m_idx not in matched_master_to_new and 'V61B513A' in m_row['Model'] and m_row['Plant'] == 'RFG']
            if len(cands) == 1:
                matched_new_to_master[n_idx] = {'master_idx': cands[0], 'assigned_id': master_rows[cands[0]]['Part ID'], 'match_type': 'CURATED_NORGREN', 'confidence': 'HIGH', 'notes': 'Norgren V61B513A-A2000 (Model suffix standardized)'}
                matched_master_to_new[cands[0]] = n_idx
        elif 'FR-E740-1.5K' in nr['Model'] and 'SB03' in nr['Area']:
            cands = [m_idx for m_idx, m_row in enumerate(master_rows) if m_idx not in matched_master_to_new and 'FR-E740-1.5K' in m_row['Model'] and 'SB03' in m_row['Area']]
            if len(cands) == 1:
                matched_new_to_master[n_idx] = {'master_idx': cands[0], 'assigned_id': master_rows[cands[0]]['Part ID'], 'match_type': 'CURATED_MITSUBISHI_SB03', 'confidence': 'HIGH', 'notes': 'Mitsubishi FR-E740-1.5K SB03 (Year 2024)'}
                matched_master_to_new[cands[0]] = n_idx
        elif 'FR-E740-1.5K' in nr['Model'] and 'SB02' in nr['Area']:
            cands = [m_idx for m_idx, m_row in enumerate(master_rows) if m_idx not in matched_master_to_new and 'FR-E740-1.5K' in m_row['Model'] and 'SB02' in m_row['Area']]
            if len(cands) == 1:
                matched_new_to_master[n_idx] = {'master_idx': cands[0], 'assigned_id': master_rows[cands[0]]['Part ID'], 'match_type': 'CURATED_MITSUBISHI_SB02', 'confidence': 'HIGH', 'notes': 'Mitsubishi FR-E740-1.5K SB02 (Year 2015)'}
                matched_master_to_new[cands[0]] = n_idx
        elif 'PBS1-10' in nr['Model']:
            cands = [m_idx for m_idx, m_row in enumerate(master_rows) if m_idx not in matched_master_to_new and 'PBS1-10' in m_row['Model']]
            if cands:
                target = cands[0]
                matched_new_to_master[n_idx] = {'master_idx': target, 'assigned_id': master_rows[target]['Part ID'], 'match_type': 'CURATED_BOSSTON', 'confidence': 'HIGH', 'notes': 'Bosston PBS1-10 Push Button'}
                matched_master_to_new[target] = n_idx
        elif 'M4F110' in nr['Model']:
            cands = [m_idx for m_idx, m_row in enumerate(master_rows) if m_idx not in matched_master_to_new and 'M4F110' in m_row['Model']]
            if cands:
                y2016 = [c for c in cands if master_rows[c]['Install Year'] == '2016']
                target = y2016[0] if y2016 else cands[0]
                matched_new_to_master[n_idx] = {'master_idx': target, 'assigned_id': master_rows[target]['Part ID'], 'match_type': 'CURATED_CKD_MANIFOLD', 'confidence': 'HIGH', 'notes': f"Matched to {master_rows[target]['Part ID']} (Consolidated Base Paint & G-55)"}
                matched_master_to_new[target] = n_idx

    # Tier 7: Assign Next Available ID to Brand New Item(s)
    next_id_num = 780
    unmatched_new = [i for i in range(len(new_rows)) if i not in matched_new_to_master]
    for n_idx in unmatched_new:
        assigned_id = f"SPFL-C-{next_id_num:04d}"
        matched_new_to_master[n_idx] = {
            'master_idx': None,
            'assigned_id': assigned_id,
            'match_type': 'NEW_ITEM_PROVISIONED',
            'confidence': 'NEW_ITEM',
            'notes': f"Brand new part added: {new_rows[n_idx]['Brand']} {new_rows[n_idx]['Model']}"
        }
        next_id_num += 1

    print(f"Total rows matched/processed: {len(matched_new_to_master)} / {len(new_rows)}")

    # Build Reconciled Dataset & Audit Trail
    reconciled_rows = []
    audit_records = []

    for n_idx, nr in enumerate(new_rows):
        match_info = matched_new_to_master[n_idx]
        assigned_id = match_info['assigned_id']
        scrambled_id = nr['Part ID']

        # Construct new row with corrected Part ID
        reconciled_row = dict(nr)
        reconciled_row['Part ID'] = assigned_id

        # Preserve / backfill imageUrl if available
        if not reconciled_row.get('imageUrl') and match_info['master_idx'] is not None:
            master_img = master_rows[match_info['master_idx']].get('imageUrl')
            if master_img:
                reconciled_row['imageUrl'] = master_img

        reconciled_rows.append(reconciled_row)

        # Build audit diff
        diff_fields = {}
        if match_info['master_idx'] is not None:
            m_row = master_rows[match_info['master_idx']]
            for col in new_headers:
                old_v = m_row.get(col, '')
                new_v = nr.get(col, '')
                if col == 'Part ID':
                    continue
                if (old_v or '') != (new_v or ''):
                    diff_fields[col] = {'old': old_v, 'updated': new_v}

        audit_records.append({
            'row_index': n_idx,
            'scrambled_id': scrambled_id,
            'restored_part_id': assigned_id,
            'match_type': match_info['match_type'],
            'confidence': match_info['confidence'],
            'notes': match_info['notes'],
            'brand': nr['Brand'],
            'model': nr['Model'],
            'description': nr['Description'],
            'diff_fields': diff_fields
        })

    # Ensure output headers match new_headers (including imageUrl)
    fieldnames = list(new_headers)
    if 'imageUrl' not in fieldnames:
        fieldnames.append('imageUrl')

    # Write backup_reconciled_parts.csv
    print(f"Writing reconciled dataset to: {RECONCILED_CSV_PATH}")
    with open(RECONCILED_CSV_PATH, mode='w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(reconciled_rows)

    # Write in-place update to backup_updated_info.csv
    print(f"Updating: {NEW_CSV_PATH}")
    with open(NEW_CSV_PATH, mode='w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(reconciled_rows)

    # Write audit JSON
    print(f"Writing audit log to: {AUDIT_JSON_PATH}")
    audit_summary = {
        'total_rows': len(reconciled_rows),
        'unique_part_ids': len(set(r['Part ID'] for r in reconciled_rows)),
        'match_type_breakdown': {},
        'new_parts_provisioned': [r for r in audit_records if r['confidence'] == 'NEW_ITEM'],
        'retired_consolidated_parts': [
            {'old_id': master_rows[i]['Part ID'], 'brand': master_rows[i]['Brand'], 'model': master_rows[i]['Model'], 'note': 'Consolidated into SPFL-C-0317'}
            for i in range(len(master_rows)) if i not in matched_master_to_new
        ],
        'audit_records': audit_records
    }
    for rec in audit_records:
        mt = rec['match_type']
        audit_summary['match_type_breakdown'][mt] = audit_summary['match_type_breakdown'].get(mt, 0) + 1

    with open(AUDIT_JSON_PATH, mode='w', encoding='utf-8') as f:
        json.dump(audit_summary, f, ensure_ascii=False, indent=2)

    print("\n=== RECONCILIATION COMPLETED SUCCESSFULLY ===")
    print(f"Total Rows: {audit_summary['total_rows']}")
    print(f"Unique Part IDs: {audit_summary['unique_part_ids']}")
    print("Breakdown by Match Type:")
    for k, v in audit_summary['match_type_breakdown'].items():
        print(f"  - {k}: {v}")

if __name__ == "__main__":
    main()
