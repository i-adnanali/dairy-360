"""Read-only checks for the PDFs exported through native browser print dialogs."""
from pathlib import Path
import json, re
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent
compact = lambda text: re.sub(r'\s+', '', text)
fixture = json.loads((ROOT / 'long-identity.json').read_text())
uuids = set(re.findall(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', json.dumps(fixture)))
results = {}
for name in ['chrome-a4-final', 'safari-a4-final', 'safari-letter-landscape-80', 'statement-a4-final']:
    reader = PdfReader(ROOT / (name + '.pdf'))
    pages = [page.extract_text() for page in reader.pages]
    text = compact(''.join(pages))
    statement = name == 'statement-a4-final'
    marker = 'Synthetic buyer statement identity' if statement else 'IDENTITY END'
    result = {
        'pages': len(pages),
        'page_size_points': [float(reader.pages[0].mediabox.width), float(reader.pages[0].mediabox.height)],
        'blank_pages': [i + 1 for i, page in enumerate(pages) if not page.strip()],
        'identity_missing_pages': [i + 1 for i, page in enumerate(pages) if compact(marker) not in compact(page)],
        'navigation_present': any(value in text for value in ['Search⌘K', 'TodayAnalyticsHerd', 'Rowsperpage', 'Recordpayment']),
    }
    if statement:
        result['missing_delivery_markers'] = [i for i in range(1,36) if f'DELIVERY-{i:02}-END' not in text]
        result['missing_payment_markers'] = [i for i in range(1,31) if f'PAYMENT-{i:02}-END' not in text]
        result['monthly_balance_present'] = 'Rs31,470.00carriedforward' in text
        result['agreed_rates_present'] = 'Agreedrates' in text
    else:
        if name in ['chrome-a4-final', 'safari-a4-final']:
            identity = compact(f"BD-0001 · {fixture['current_snapshot']['animal']['name']} · Generated {fixture['generated_at']}")
            body = ''.join(compact('\n'.join(page.splitlines()[2:]) if name.startswith('safari') else page).replace(identity, '') for page in pages)
            audit = body[body.index('Technicalaudit·completeresponse'):]
            audit = audit[audit.index('{'):]
            result['complete_audit_matches_fixture_ignoring_whitespace'] = audit == compact(json.dumps(fixture, ensure_ascii=False))
        result['unique_fixture_uuids'] = len(uuids)
        result['missing_fixture_uuids'] = sorted(value for value in uuids if value not in text)
        result['audit_end_present'] = 'Bulk sales and shared feed/payroll costs are not attributable animal profit.'.replace(' ','') in text
    results[name] = result
(ROOT / 'pdf-checks.json').write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps(results, indent=2))
