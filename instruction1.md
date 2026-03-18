# POS Improvement Master Instructions (Small Retail Shop)

## 1) Goal
Upgrade this POS into a reliable day-to-day system for a small grocery shop with:
- safer data
- better accounting/reporting
- better stock control
- daily operations support

This file is a practical execution plan for implementing all identified gaps.

## 2) Priority Order (Do This First)

### Phase 1 (Critical for real business use)
1. Auto backup and restore hardening
2. User login + role permissions
3. Day-end closing report
4. Customer credit ledger + supplier payable ledger
5. Expiry/batch tracking

### Phase 2 (High value)
1. Better price/margin analytics
2. Reorder suggestions from low-stock/min-stock
3. Better exports (XLSX multi-sheet)
4. Audit trail for edits/deletes

### Phase 3 (Nice to have)
1. Multi-device sync (cloud/local server)
2. Advanced dashboards and forecasting

---

## 3) Detailed Implementation Instructions

## A. Data Safety and Backup

### A1. Backup scheduler
- Add a daily auto-backup trigger (at app open + if last backup > 24h).
- Keep last N backups (example: 14 files).
- Backup format: JSON with version, timestamp, checksum.

### A2. Backup integrity
- Add checksum field when exporting data.
- Validate checksum before import.
- If validation fails, block import and show clear error.

### A3. Recovery UX
- Add a "Restore from backup" flow with:
	- file select
	- data summary preview
	- final confirmation

### Done criteria
- Can restore full data after clear/reset.
- Corrupt backup is rejected.

---

## B. Authentication and Roles

### B1. Login screen
- Add basic login modal/page before app usage.
- Store users in DB table: users (id, username, passwordHash, role, active).

### B2. Roles
- owner: all access
- manager: reports + inventory + returns + expenses
- cashier: POS + limited returns

### B3. Permission guard
- Wrap sensitive actions (data clear, import, delete records, settings changes) with role check.
- Replace hardcoded password checks with permission checks.

### Done criteria
- Unauthorized user cannot execute restricted actions.

---

## C. Day-End Closing

### C1. End-of-day close module
- Add a Close Day page or modal with:
	- opening cash
	- cash sales
	- returns impact
	- expenses
	- expected cash
	- actual cash count
	- over/short amount

### C2. Close records table
- New DB table: day_closings (id, date, openingCash, expectedCash, actualCash, variance, closedBy, notes, createdAt).

### C3. Daily close report export
- CSV/XLSX export for daily close.

### Done criteria
- Shop can close each day with reconciliation history.

---

## D. Customer Credit and Supplier Payables

### D1. Customer credit ledger
- New tables:
	- customers (id, name, phone, address, active)
	- customer_ledger (id, customerId, date, type[sale/payment/adjustment], amount, ref, note)

### D2. Supplier payable ledger
- New tables:
	- suppliers (id, name, phone, active)
	- supplier_ledger (id, supplierId, date, type[purchase/payment/credit], amount, ref, note)

### D3. Integration points
- Purchase save -> supplier payable increases.
- Supplier return -> payable decreases.
- Credit sale -> customer balance increases.
- Payment collection -> customer balance decreases.

### Done criteria
- Can view current outstanding by customer/supplier and full history.

---

## E. Expiry and Batch Tracking

### E1. Product batches
- Add batch table: stock_batches (id, productId, barcode, batchNo, mfgDate, expDate, qty, buyingPrice, sellingPrice, createdAt).

### E2. FIFO / FEFO
- For sale issue by FEFO (earliest expiry first) when expiry exists.
- For non-expiry products, FIFO is fine.

### E3. Alerts
- Add alert widgets:
	- expired items
	- expiring in 7 days
	- expiring in 30 days

### Done criteria
- Sales and reports can identify which batch moved and what is near expiry.

---

## F. Reporting and Accounting Hardening

### F1. Income statement formulas
Use and display:
- Gross Sales
- Less Customer Returns
- Net Sales
- COGS Gross
- Less Supplier Return Credit
- Less Customer Return Cost (Stock Back Value)
- Net COGS
- Gross Profit
- Other Expenses
- Net Profit

### F2. Expense category analytics
- Category totals
- % share
- Trend by date range

### F3. Stock valuation section
- Sell value
- Cost value
- As-of date consistency with export

### Done criteria
- On-screen values and exported values match for same date range.

---

## G. Data Model Versioning

When adding new tables/fields, increase DB version and migration carefully.

### Required migration checks
1. Existing data stays intact after upgrade
2. New tables initialize safely
3. Import/export backward compatibility is handled

---

## H. Quality and Testing Checklist

## H1. Functional tests
- POS sale
- Purchase receive
- Customer return
- Supplier return
- Expense add/edit/delete
- Income statement generation
- Stock export
- Income statement export
- Backup export/import

## H2. Edge-case tests
- Duplicate barcode with different price batches
- Partial returns multiple times against one bill line
- Edit/delete returns after further sales/purchases
- Negative/zero quantity and amount validation

## H3. Regression checks
- Dashboard stats
- Receipt printing
- Category filters
- Date range reports

---

## I. UI/UX Improvements (Recommended)

1. Add clear helper text for accounting lines
2. Add loading indicators for heavy report/export actions
3. Add success/error toast notifications instead of only alerts
4. Add confirmation dialogs for destructive actions

---

## J. Suggested Execution Timeline

Week 1:
- Backup hardening + role/auth basics

Week 2:
- Day-end closing + ledgers

Week 3:
- Batch/expiry system + alerts

Week 4:
- Reporting hardening + XLSX + QA pass

---

## K. Definition of "Business Ready"

System is considered business-ready when:
1. Daily close can be done with variance report
2. Backup/restore is reliable and tested
3. Credit/payable balances are accurate
4. Expiry risks are visible
5. Reports match exports and accounting formulas

