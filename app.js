// Main Application Logic for Sillara-POS
// Global variables
let currentPage = 'dashboard';
let cart = [];
let products = [];
let currentFilter = 'all';
let purchaseCart = [];
let loadedReturnBill = null;
let lastIncomeStatement = null;
let currentUser = null;
const DAY_CLOSE_DENOMINATIONS = [5000, 1000, 500, 100, 50, 20, 10, 5, 2, 1];
let dayClosePreviewToken = 0;

const AUTO_BACKUP_KEY = 'sillara-auto-backups';
const AUTO_BACKUP_LAST_KEY = 'sillara-auto-backup-last';
const AUTO_BACKUP_LIMIT = 14;

const ROLE_PERMISSIONS = {
    owner: ['*'],
    manager: ['settings:write', 'settings:read', 'data:export', 'dayclose:write', 'reports:read', 'inventory:read', 'inventory:write', 'returns:write', 'expenses:write', 'pos:sale'],
    cashier: ['pos:sale', 'returns:customer']
};

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    await initApp();
    showPage('dashboard');
    
    // Set default dates for reports
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('report-from-date').value = today;
    document.getElementById('report-to-date').value = today;

    const expenseDateEl = document.getElementById('expense-date');
    const expenseFromDateEl = document.getElementById('expense-from-date');
    const expenseToDateEl = document.getElementById('expense-to-date');
    const returnFromDateEl = document.getElementById('return-from-date');
    const returnToDateEl = document.getElementById('return-to-date');
    const customerReturnDateEl = document.getElementById('customer-return-date');
    const supplierReturnDateEl = document.getElementById('supplier-return-date');
    const dayCloseDateEl = document.getElementById('day-close-date');
    const customerPaymentDateEl = document.getElementById('customer-payment-date');
    const supplierPaymentDateEl = document.getElementById('supplier-payment-date');
    if (expenseDateEl) expenseDateEl.value = today;
    if (expenseFromDateEl) {
        const monthStart = new Date();
        monthStart.setDate(1);
        expenseFromDateEl.value = monthStart.toISOString().split('T')[0];
    }
    if (expenseToDateEl) expenseToDateEl.value = today;
    if (returnFromDateEl) {
        const monthStart = new Date();
        monthStart.setDate(1);
        returnFromDateEl.value = monthStart.toISOString().split('T')[0];
    }
    if (returnToDateEl) returnToDateEl.value = today;
    if (customerReturnDateEl) customerReturnDateEl.value = today;
    if (supplierReturnDateEl) supplierReturnDateEl.value = today;
    if (dayCloseDateEl) dayCloseDateEl.value = today;
    if (customerPaymentDateEl) customerPaymentDateEl.value = today;
    if (supplierPaymentDateEl) supplierPaymentDateEl.value = today;
    updateDayClosePreview();

    const savedUserRaw = sessionStorage.getItem('sillara-user');
    if (savedUserRaw) {
        try {
            const saved = JSON.parse(savedUserRaw);
            if (saved?.username) {
                const fresh = await DB.users.getByUsername(saved.username);
                if (fresh && fresh.active) {
                    currentUser = {
                        id: fresh.id,
                        username: fresh.username,
                        role: fresh.role
                    };
                }
            }
        } catch (err) {
            console.warn('Invalid saved session user', err);
        }
    }
    updateCurrentUserDisplay();
    if (!currentUser) showLoginModal();
});

// Initialize application
async function initApp() {
    await DB.users.ensureDefaults();
    await runAutoBackupIfDue();
    await loadProducts();
    await loadCategories();
    await loadPaymentFormOptions();
    await updateDashboard();
    await refreshLedgerSummaryCards();
    console.log('Sillara-POS Application initialized!');
}

function formatDateForDisplay(dateValue) {
    const date = new Date(dateValue);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-GB');
}

function dateKeyOf(value) {
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().split('T')[0];
}

function getAutoBackups() {
    try {
        const raw = localStorage.getItem(AUTO_BACKUP_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveAutoBackups(backups) {
    localStorage.setItem(AUTO_BACKUP_KEY, JSON.stringify(backups));
}

function summarizeBackupData(data) {
    return {
        products: Array.isArray(data.products) ? data.products.length : 0,
        sales: Array.isArray(data.sales) ? data.sales.length : 0,
        purchases: Array.isArray(data.purchases) ? data.purchases.length : 0,
        expenses: Array.isArray(data.expenses) ? data.expenses.length : 0,
        returns: Array.isArray(data.returns) ? data.returns.length : 0,
        dayClosings: Array.isArray(data.dayClosings) ? data.dayClosings.length : 0,
        customers: Array.isArray(data.customers) ? data.customers.length : 0,
        suppliers: Array.isArray(data.suppliers) ? data.suppliers.length : 0
    };
}

function formatBackupSummary(summary) {
    return `Products: ${summary.products}, Sales: ${summary.sales}, Purchases: ${summary.purchases}, Expenses: ${summary.expenses}, Returns: ${summary.returns}, Day Closings: ${summary.dayClosings}, Customers: ${summary.customers}, Suppliers: ${summary.suppliers}`;
}

function validateBackupPayload(data) {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid backup file: not a JSON object.');
    }

    const requiredArrayKeys = ['products', 'sales', 'purchases', 'expenses', 'returns'];
    for (const key of requiredArrayKeys) {
        if (!(key in data)) {
            throw new Error(`Invalid backup file: missing key "${key}".`);
        }
        if (!Array.isArray(data[key])) {
            throw new Error(`Invalid backup file: "${key}" must be an array.`);
        }
    }
}

async function createAutoBackup(reason = 'auto') {
    const data = await DB.exportAll();
    const summary = summarizeBackupData(data);
    const item = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        reason,
        summary,
        data
    };

    const backups = getAutoBackups();
    backups.unshift(item);
    const sliced = backups.slice(0, AUTO_BACKUP_LIMIT);
    saveAutoBackups(sliced);
    localStorage.setItem(AUTO_BACKUP_LAST_KEY, item.createdAt);
}

async function runAutoBackupIfDue() {
    const last = localStorage.getItem(AUTO_BACKUP_LAST_KEY);
    if (!last) {
        await createAutoBackup('first-run');
        return;
    }
    const elapsed = Date.now() - new Date(last).getTime();
    if (Number.isNaN(elapsed) || elapsed >= 24 * 60 * 60 * 1000) {
        await createAutoBackup('daily-open');
    }
}

async function createManualAutoBackup() {
    if (!requirePermission('settings:write', 'Only owner/manager can save local snapshots.')) return;
    await createAutoBackup('manual');
    alert('Local snapshot saved');
}

async function restoreAutoBackup() {
    if (!requirePermission('settings:write', 'Only owner/manager can restore local snapshots.')) return;

    const backups = getAutoBackups();
    if (backups.length === 0) {
        alert('No local snapshots found');
        return;
    }

    const listing = backups.slice(0, 10).map((b, idx) => {
        const summary = b.summary ? formatBackupSummary(b.summary) : 'No summary';
        return `${idx + 1}. ${new Date(b.createdAt).toLocaleString()} | ${b.reason} | ${summary}`;
    }).join('\n');

    const choice = prompt(`Select snapshot number to restore:\n\n${listing}`);
    const index = Number(choice) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= backups.length) {
        if (choice !== null) alert('Invalid selection');
        return;
    }

    const selected = backups[index];
    const summary = selected.summary ? formatBackupSummary(selected.summary) : 'No summary';
    if (!confirm(`Restore this snapshot?\n${new Date(selected.createdAt).toLocaleString()}\n${summary}`)) return;

    await DB.importAll(selected.data);
    await loadProducts();
    await loadCategories();
    await updateDashboard();
    await refreshLedgerSummaryCards();
    if (currentPage === 'parties') {
        await loadPaymentFormOptions();
        await loadLedgerTables();
        await loadUnpaidPurchases();
        await loadCustomerPaymentStatus();
        await loadSupplierPaymentStatus();
    }
    if (currentPage === 'reports') await generateReport();
    showPage(currentPage);
    alert('Snapshot restored successfully');
}

function customerLedgerImpact(entry) {
    const amount = Number(entry?.amount) || 0;
    const type = (entry?.type || '').toLowerCase();
    if (type === 'sale' || type === 'adjustment') return amount;
    if (type === 'payment') return -amount;
    return 0;
}

function supplierLedgerImpact(entry) {
    const amount = Number(entry?.amount) || 0;
    const type = (entry?.type || '').toLowerCase();
    if (type === 'purchase' || type === 'adjustment') return amount;
    if (type === 'payment' || type === 'credit') return -amount;
    return 0;
}

async function getCustomerOutstandingTotal(cutoffDate = '') {
    const entries = await DB.customer_ledger.getAll();
    return entries
        .filter((e) => !cutoffDate || dateKeyOf(e.date) <= cutoffDate)
        .reduce((sum, e) => sum + customerLedgerImpact(e), 0);
}

async function getSupplierOutstandingTotal(cutoffDate = '') {
    const entries = await DB.supplier_ledger.getAll();
    return entries
        .filter((e) => !cutoffDate || dateKeyOf(e.date) <= cutoffDate)
        .reduce((sum, e) => sum + supplierLedgerImpact(e), 0);
}

async function refreshLedgerSummaryCards() {
    const customerOutstanding = await getCustomerOutstandingTotal();
    const supplierOutstanding = await getSupplierOutstandingTotal();

    const settingsCustomer = document.getElementById('settings-customer-outstanding');
    const settingsSupplier = document.getElementById('settings-supplier-outstanding');
    if (settingsCustomer) settingsCustomer.textContent = customerOutstanding.toFixed(2);
    if (settingsSupplier) settingsSupplier.textContent = supplierOutstanding.toFixed(2);
}

async function loadUnpaidPurchases() {
    const table = document.getElementById('unpaid-purchases-table');
    if (!table) return;

    try {
        const unpaid = await DB.getUnpaidPurchases();
        
        if (unpaid.length === 0) {
            table.innerHTML = '<tr><td colspan="7" class="text-center text-gray-500">All purchases are fully paid</td></tr>';
            return;
        }

        table.innerHTML = unpaid.map(status => {
            const purchaseDate = new Date(status.purchase.date).toLocaleDateString();
            const progressColor = status.isPartiallyPaid ? 'bg-yellow-500' : 'bg-red-500';
            
            return `
                <tr class="border-b hover:bg-gray-50">
                    <td class="p-3 text-sm">#${status.purchaseId}</td>
                    <td class="p-3 text-sm">${status.purchase.supplier || 'Unknown'}</td>
                    <td class="p-3 text-sm">${purchaseDate}</td>
                    <td class="p-3 text-sm font-semibold">Rs. ${status.totalCost.toFixed(2)}</td>
                    <td class="p-3 text-sm">Rs. ${status.totalPaid.toFixed(2)}</td>
                    <td class="p-3 text-sm font-bold text-red-600">Rs. ${status.outstanding.toFixed(2)}</td>
                    <td class="p-3 flex items-center gap-2">
                        <div class="w-20 bg-gray-200 rounded h-2">
                            <div class="${progressColor} h-2 rounded" style="width: ${status.paymentPercentage}%"></div>
                        </div>
                        <span class="text-xs font-semibold">${status.paymentPercentage}%</span>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading unpaid purchases:', error);
        table.innerHTML = '<tr><td colspan="7" class="text-center text-red-500">Error loading data</td></tr>';
    }
}

async function loadCustomerPaymentStatus() {
    const table = document.getElementById('customer-payment-status-table');
    if (!table) return;

    try {
        const customers = await DB.getCustomersByOutstandingAmount();
        
        if (customers.length === 0) {
            table.innerHTML = '<tr><td colspan="7" class="text-center text-gray-500">No outstanding customer balances</td></tr>';
            return;
        }

        table.innerHTML = customers.map(status => {
            const utilizationColor = status.creditUtilization > 100 ? 'bg-red-500' : (status.creditUtilization > 75 ? 'bg-yellow-500' : 'bg-green-500');
            const phone = status.customer.phone || 'N/A';
            const creditLimit = status.creditLimit || 'Unlimited';
            
            return `
                <tr class="border-b hover:bg-gray-50 ${status.isOverLimit ? 'bg-red-50' : ''}">
                    <td class="px-3 py-2 text-sm font-semibold">${status.customer.name}</td>
                    <td class="px-3 py-2 text-sm">${phone}</td>
                    <td class="px-3 py-2 text-sm font-bold text-red-600">Rs. ${status.totalOutstanding.toFixed(2)}</td>
                    <td class="px-3 py-2 text-sm ${status.overdueAmount > 0 ? 'font-bold text-red-700' : 'text-gray-600'}">
                        ${status.overdueAmount > 0 ? `Rs. ${status.overdueAmount.toFixed(2)}` : '-'}
                    </td>
                    <td class="px-3 py-2 text-sm">${typeof creditLimit === 'number' ? `Rs. ${creditLimit.toFixed(2)}` : creditLimit}</td>
                    <td class="px-3 py-2 text-sm">${typeof creditLimit === 'number' ? `Rs. ${status.availableCredit.toFixed(2)}` : 'Unlimited'}</td>
                    <td class="px-3 py-2 flex items-center justify-center gap-2">
                        <div class="w-16 bg-gray-200 rounded h-2">
                            <div class="${utilizationColor} h-2 rounded" style="width: ${Math.min(status.creditUtilization, 100)}%"></div>
                        </div>
                        <span class="text-xs font-semibold ${status.isOverLimit ? 'text-red-600' : ''}">${status.creditUtilization}%</span>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading customer payment status:', error);
        table.innerHTML = '<tr><td colspan="7" class="text-center text-red-500">Error loading data</td></tr>';
    }
}

async function loadSupplierPaymentStatus() {
    const table = document.getElementById('supplier-payment-status-table');
    if (!table) return;

    try {
        const suppliers = await DB.getSuppliersByOutstandingAmount();
        
        if (suppliers.length === 0) {
            table.innerHTML = '<tr><td colspan="5" class="text-center text-gray-500">No outstanding supplier balances</td></tr>';
            return;
        }

        table.innerHTML = suppliers.map(status => {
            const overdueClass = status.overdueAmount > 0 ? 'text-red-700 font-bold' : 'text-gray-600';
            const creditLimitDisplay = status.creditLimit > 0 ? `Rs. ${status.creditLimit.toFixed(2)}` : 'Unlimited';
            
            return `
                <tr class="border-b hover:bg-gray-50 ${status.overdueAmount > 0 ? 'bg-red-50' : ''}">
                    <td class="px-3 py-2 text-sm font-semibold">${status.supplier.name}</td>
                    <td class="px-3 py-2 text-sm text-blue-600">${status.paymentTerms}</td>
                    <td class="px-3 py-2 text-sm font-bold text-orange-600">Rs. ${status.totalOutstanding.toFixed(2)}</td>
                    <td class="px-3 py-2 text-sm ${overdueClass}">
                        ${status.overdueAmount > 0 ? `Rs. ${status.overdueAmount.toFixed(2)}` : '-'}
                    </td>
                    <td class="px-3 py-2 text-sm">${creditLimitDisplay}</td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading supplier payment status:', error);
        table.innerHTML = '<tr><td colspan="5" class="text-center text-red-500">Error loading data</td></tr>';
    }
}

async function loadPaymentFormOptions() {
    const customerSelect = document.getElementById('customer-payment-customer-id');
    const supplierSelect = document.getElementById('supplier-payment-supplier-id');
    const posCreditCustomerSelect = document.getElementById('pos-credit-customer-select');
    const purchaseSupplierSelect = document.getElementById('purchase-supplier-select');
    const creditCustomerCodes = document.getElementById('credit-customer-codes');
    const customerDate = document.getElementById('customer-payment-date');
    const supplierDate = document.getElementById('supplier-payment-date');

    const today = new Date().toISOString().split('T')[0];
    if (customerDate && !customerDate.value) customerDate.value = today;
    if (supplierDate && !supplierDate.value) supplierDate.value = today;

    if (!customerSelect || !supplierSelect) return;

    const [customers, suppliers] = await Promise.all([
        DB.customers.getAll(),
        DB.suppliers.getAll()
    ]);

    const selectedCustomer = customerSelect.value;
    const selectedSupplier = supplierSelect.value;

    customerSelect.innerHTML = '<option value="">Select existing customer (optional)</option>';
    customers
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .forEach((c) => {
            const phone = c.phone ? ` - ${c.phone}` : '';
            const codeLabel = c.code ? `[${c.code}] ` : '';
            customerSelect.innerHTML += `<option value="${c.id}">${codeLabel}${c.name || 'Customer'}${phone}</option>`;
        });

    supplierSelect.innerHTML = '<option value="">Select existing supplier (optional)</option>';
    suppliers
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .forEach((s) => {
            const terms = s.paymentTerms ? ` (${s.paymentTerms})` : '';
            const codeLabel = s.code ? `[${s.code}] ` : '';
            supplierSelect.innerHTML += `<option value="${s.id}">${codeLabel}${s.name || 'Supplier'}${terms}</option>`;
        });

    if (selectedCustomer && customerSelect.querySelector(`option[value="${selectedCustomer}"]`)) {
        customerSelect.value = selectedCustomer;
    }
    if (selectedSupplier && supplierSelect.querySelector(`option[value="${selectedSupplier}"]`)) {
        supplierSelect.value = selectedSupplier;
    }

    if (posCreditCustomerSelect) {
        const selectedPos = posCreditCustomerSelect.value;
        posCreditCustomerSelect.innerHTML = '<option value="">Select saved customer (optional)</option>';
        customers
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
            .forEach((c) => {
                const codeLabel = c.code ? `[${c.code}] ` : '';
                const phone = c.phone ? ` - ${c.phone}` : '';
                posCreditCustomerSelect.innerHTML += `<option value="${c.id}">${codeLabel}${c.name || 'Customer'}${phone}</option>`;
            });
        if (selectedPos && posCreditCustomerSelect.querySelector(`option[value="${selectedPos}"]`)) {
            posCreditCustomerSelect.value = selectedPos;
        }
    }

    if (purchaseSupplierSelect) {
        const selectedPurchaseSupplier = purchaseSupplierSelect.value;
        purchaseSupplierSelect.innerHTML = '<option value="">Select supplier from saved list</option>';
        suppliers
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
            .forEach((s) => {
                const codeLabel = s.code ? `[${s.code}] ` : '';
                purchaseSupplierSelect.innerHTML += `<option value="${s.id}">${codeLabel}${s.name || 'Supplier'}</option>`;
            });
        if (selectedPurchaseSupplier && purchaseSupplierSelect.querySelector(`option[value="${selectedPurchaseSupplier}"]`)) {
            purchaseSupplierSelect.value = selectedPurchaseSupplier;
        }
    }

    if (creditCustomerCodes) {
        creditCustomerCodes.innerHTML = customers
            .filter((c) => c.code)
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
            .map((c) => `<option value="${c.code}">${(c.name || '').replaceAll('"', '&quot;')}</option>`)
            .join('');
    }

    await handleSupplierPaymentSupplierChange();
}

async function handleSupplierPaymentSupplierChange() {
    const supplierSelect = document.getElementById('supplier-payment-supplier-id');
    const supplierNameInput = document.getElementById('supplier-payment-name');
    const purchaseSelect = document.getElementById('supplier-payment-purchase-id');
    if (!supplierSelect || !supplierNameInput || !purchaseSelect) return;

    purchaseSelect.innerHTML = '<option value="">Apply to all unpaid purchases (auto)</option>';

    const supplierId = Number(supplierSelect.value || 0);
    if (!supplierId) return;

    const allSuppliers = await DB.suppliers.getAll();
    const supplier = allSuppliers.find((s) => Number(s.id) === supplierId);
    if (!supplier) return;

    supplierNameInput.value = supplier.name || '';

    const allPurchases = await DB.purchases.getAll();
    const supplierPurchases = allPurchases
        .filter((p) => ((p.supplier || '').trim().toLowerCase() === (supplier.name || '').trim().toLowerCase()))
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    for (const purchase of supplierPurchases) {
        const status = await DB.getPurchasePaymentStatus(purchase.id);
        if (!status || status.outstanding <= 0) continue;
        const d = formatDateForDisplay(purchase.date);
        purchaseSelect.innerHTML += `<option value="${purchase.id}">#${purchase.id} | ${d} | Outstanding Rs. ${status.outstanding.toFixed(2)}</option>`;
    }
}

async function handleCustomerPaymentCustomerChange() {
    const customerSelect = document.getElementById('customer-payment-customer-id');
    const customerNameInput = document.getElementById('customer-payment-name');
    if (!customerSelect || !customerNameInput) return;

    const customerId = Number(customerSelect.value || 0);
    if (!customerId) return;

    const customers = await DB.customers.getAll();
    const customer = customers.find((c) => Number(c.id) === customerId);
    if (customer) {
        customerNameInput.value = customer.name || '';
    }
}

async function loadPartyMasterDefaults() {
    const customerCodeEl = document.getElementById('master-customer-code');
    const supplierCodeEl = document.getElementById('master-supplier-code');
    if (customerCodeEl && !customerCodeEl.value) customerCodeEl.value = await DB.customers.generateNextCode();
    if (supplierCodeEl && !supplierCodeEl.value) supplierCodeEl.value = await DB.suppliers.generateNextCode();
}

async function addCustomerMaster(event) {
    event.preventDefault();
    if (!requirePermission('settings:write', 'Only owner/manager can add customers.')) return;

    const code = document.getElementById('master-customer-code')?.value?.trim() || '';
    const name = document.getElementById('master-customer-name')?.value?.trim() || '';
    const phone = document.getElementById('master-customer-phone')?.value?.trim() || '';
    const creditLimit = Number(document.getElementById('master-customer-limit')?.value || 0);
    if (!code || !name) {
        alert('Please enter customer number and name');
        return;
    }

    try {
        const existing = await DB.customers.getByCode(code);
        if (existing) {
            await DB.customers.update(existing.id, { name, phone, creditLimit: Math.max(0, creditLimit), active: true });
        } else {
            await DB.customers.add({ code, name, phone, creditLimit: Math.max(0, creditLimit), active: true });
        }

        document.getElementById('master-customer-name').value = '';
        document.getElementById('master-customer-phone').value = '';
        document.getElementById('master-customer-limit').value = '';
        document.getElementById('master-customer-code').value = await DB.customers.generateNextCode();
        await loadPaymentFormOptions();
        await loadPartyMasterTables();
        await loadCustomerPaymentStatus();
        alert('Customer saved');
    } catch (error) {
        console.error('Customer save failed', error);
        alert('Unable to save customer. Check customer number/code uniqueness.');
    }
}

async function addSupplierMaster(event) {
    event.preventDefault();
    if (!requirePermission('settings:write', 'Only owner/manager can add suppliers.')) return;

    const code = document.getElementById('master-supplier-code')?.value?.trim() || '';
    const name = document.getElementById('master-supplier-name')?.value?.trim() || '';
    const phone = document.getElementById('master-supplier-phone')?.value?.trim() || '';
    const creditLimit = Number(document.getElementById('master-supplier-limit')?.value || 0);
    const paymentTerms = document.getElementById('master-supplier-terms')?.value?.trim() || 'Net 30';
    if (!code || !name) {
        alert('Please enter supplier number and name');
        return;
    }

    try {
        const existing = await DB.suppliers.getByCode(code);
        if (existing) {
            await DB.suppliers.update(existing.id, { name, phone, creditLimit: Math.max(0, creditLimit), paymentTerms, active: true });
        } else {
            await DB.suppliers.add({ code, name, phone, creditLimit: Math.max(0, creditLimit), paymentTerms, active: true });
        }

        document.getElementById('master-supplier-name').value = '';
        document.getElementById('master-supplier-phone').value = '';
        document.getElementById('master-supplier-limit').value = '';
        document.getElementById('master-supplier-terms').value = '';
        document.getElementById('master-supplier-code').value = await DB.suppliers.generateNextCode();
        await loadPaymentFormOptions();
        await loadPartyMasterTables();
        await loadSupplierPaymentStatus();
        alert('Supplier saved');
    } catch (error) {
        console.error('Supplier save failed', error);
        alert('Unable to save supplier. Check supplier number/code uniqueness.');
    }
}

async function loadPartyMasterTables() {
    const customerBody = document.getElementById('customer-master-table-body');
    const supplierBody = document.getElementById('supplier-master-table-body');

    const [customers, suppliers] = await Promise.all([
        DB.customers.getAll(),
        DB.suppliers.getAll()
    ]);

    if (customerBody) {
        const rows = [...customers].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        customerBody.innerHTML = rows.length
            ? rows.map((c) => `
                <tr class="border-b border-gray-100">
                    <td class="px-3 py-2">${c.code || ''}</td>
                    <td class="px-3 py-2">${c.name || ''}</td>
                    <td class="px-3 py-2">${c.phone || '-'}</td>
                    <td class="px-3 py-2 text-right">${Number(c.creditLimit || 0).toFixed(2)}</td>
                    <td class="px-3 py-2 text-center">
                        <button type="button" onclick="editCustomerMaster(${c.id})" class="px-2 py-1 text-xs bg-indigo-100 text-indigo-700 rounded-lg font-semibold hover:bg-indigo-200">Edit</button>
                    </td>
                </tr>
            `).join('')
            : '<tr><td colspan="5" class="text-center p-4 text-gray-500">No customers yet</td></tr>';
    }

    if (supplierBody) {
        const rows = [...suppliers].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        supplierBody.innerHTML = rows.length
            ? rows.map((s) => `
                <tr class="border-b border-gray-100">
                    <td class="px-3 py-2">${s.code || ''}</td>
                    <td class="px-3 py-2">${s.name || ''}</td>
                    <td class="px-3 py-2">${s.phone || '-'}</td>
                    <td class="px-3 py-2">${s.paymentTerms || 'Net 30'}</td>
                    <td class="px-3 py-2 text-center">
                        <button type="button" onclick="editSupplierMaster(${s.id})" class="px-2 py-1 text-xs bg-rose-100 text-rose-700 rounded-lg font-semibold hover:bg-rose-200">Edit</button>
                    </td>
                </tr>
            `).join('')
            : '<tr><td colspan="5" class="text-center p-4 text-gray-500">No suppliers yet</td></tr>';
    }
}

async function editCustomerMaster(customerId) {
    if (!requirePermission('settings:write', 'Only owner/manager can edit customers.')) return;

    const customers = await DB.customers.getAll();
    const row = customers.find((c) => Number(c.id) === Number(customerId));
    if (!row) {
        alert('Customer not found');
        return;
    }

    const code = prompt('Customer number/code', row.code || '');
    if (code === null) return;
    const name = prompt('Customer name', row.name || '');
    if (name === null) return;
    const phone = prompt('Phone', row.phone || '');
    if (phone === null) return;
    const limitRaw = prompt('Credit limit', String(Number(row.creditLimit || 0)));
    if (limitRaw === null) return;

    const normalizedCode = String(code || '').trim();
    const normalizedName = String(name || '').trim();
    const creditLimit = Math.max(0, Number(limitRaw || 0));
    if (!normalizedCode || !normalizedName || Number.isNaN(creditLimit)) {
        alert('Please enter valid customer details');
        return;
    }

    const existingByCode = await DB.customers.getByCode(normalizedCode);
    if (existingByCode && Number(existingByCode.id) !== Number(row.id)) {
        alert('Another customer already uses this code');
        return;
    }

    await DB.customers.update(row.id, {
        code: normalizedCode,
        name: normalizedName,
        phone: String(phone || '').trim(),
        creditLimit,
        active: true
    });

    await loadPaymentFormOptions();
    await loadPartyMasterTables();
    await loadCustomerPaymentStatus();
    alert('Customer updated');
}

async function editSupplierMaster(supplierId) {
    if (!requirePermission('settings:write', 'Only owner/manager can edit suppliers.')) return;

    const suppliers = await DB.suppliers.getAll();
    const row = suppliers.find((s) => Number(s.id) === Number(supplierId));
    if (!row) {
        alert('Supplier not found');
        return;
    }

    const code = prompt('Supplier number/code', row.code || '');
    if (code === null) return;
    const name = prompt('Supplier name', row.name || '');
    if (name === null) return;
    const phone = prompt('Phone', row.phone || '');
    if (phone === null) return;
    const terms = prompt('Payment terms', row.paymentTerms || 'Net 30');
    if (terms === null) return;

    const normalizedCode = String(code || '').trim();
    const normalizedName = String(name || '').trim();
    if (!normalizedCode || !normalizedName) {
        alert('Please enter valid supplier details');
        return;
    }

    const existingByCode = await DB.suppliers.getByCode(normalizedCode);
    if (existingByCode && Number(existingByCode.id) !== Number(row.id)) {
        alert('Another supplier already uses this code');
        return;
    }

    await DB.suppliers.update(row.id, {
        code: normalizedCode,
        name: normalizedName,
        phone: String(phone || '').trim(),
        paymentTerms: String(terms || 'Net 30').trim() || 'Net 30',
        active: true
    });

    await loadPaymentFormOptions();
    await loadPartyMasterTables();
    await loadSupplierPaymentStatus();
    alert('Supplier updated');
}

async function updateReportCurrentStockTotal() {
    const totalEl = document.getElementById('report-current-stock-total');
    const costEl = document.getElementById('report-current-stock-cost-total');
    if (!totalEl && !costEl) return;

    const cutoffDateTime = getStockCutoffDateTimeFromReport();
    if (!cutoffDateTime) {
        if (totalEl) totalEl.textContent = '0.00';
        if (costEl) costEl.textContent = '0.00';
        return;
    }

    const snapshot = await buildStockSnapshot(cutoffDateTime);
    if (totalEl) totalEl.textContent = snapshot.totalSellValue.toFixed(2);
    if (costEl) costEl.textContent = snapshot.totalBuyValue.toFixed(2);
}

function getStockCutoffDateTimeFromReport() {
    const toDateInput = document.getElementById('report-to-date')?.value;
    const todayKey = new Date().toISOString().split('T')[0];
    const selectedDate = toDateInput || todayKey;

    const selectedDateStart = new Date(selectedDate);
    selectedDateStart.setHours(0, 0, 0, 0);
    if (isNaN(selectedDateStart.getTime())) {
        return null;
    }

    return selectedDate === todayKey
        ? new Date()
        : new Date(new Date(selectedDate).setHours(23, 59, 59, 999));
}

async function buildStockSnapshot(cutoffDateTime) {
    const products = await DB.products.getAll();
    const purchases = await DB.purchases.getAll();
    const sales = await DB.sales.getAll();
    const returns = await DB.returns.getAll();

    const byPid = new Map(products.map(p => [String(p.id), p]));
    const byBarcode = new Map();
    products.forEach((p) => {
        const barcode = p.barcode || '';
        if (!barcode) return;
        if (!byBarcode.has(barcode)) byBarcode.set(barcode, []);
        byBarcode.get(barcode).push(p);
    });
    const byName = new Map(products.map(p => [p.name || '', p]));

    const resolveProduct = (item) => {
        if (item.productId && byPid.has(String(item.productId))) return byPid.get(String(item.productId));

        if (item.barcode && byBarcode.has(item.barcode)) {
            const candidates = byBarcode.get(item.barcode) || [];
            if (candidates.length === 1) return candidates[0];

            const sellingPrice = Number(item.price ?? item.sellingPrice);
            if (!Number.isNaN(sellingPrice)) {
                const bySellPrice = candidates.find(p => Number(p.price) === sellingPrice);
                if (bySellPrice) return bySellPrice;
            }

            const buyingPrice = Number(item.buyingPrice ?? item.cost);
            if (!Number.isNaN(buyingPrice)) {
                const byBuyPrice = candidates.find(p => Number(p.buyingPrice) === buyingPrice);
                if (byBuyPrice) return byBuyPrice;
            }

            const byExactName = candidates.find(p => (p.name || '') === (item.name || item.productName || ''));
            if (byExactName) return byExactName;

            return candidates[0] || null;
        }

        if (item.name && byName.has(item.name)) return byName.get(item.name);
        if (item.productName && byName.has(item.productName)) return byName.get(item.productName);
        return null;
    };

    const stockAdjustments = new Map();
    const purchaseDateByProduct = new Map();

    products.forEach((p) => {
        stockAdjustments.set(String(p.id), 0);
        purchaseDateByProduct.set(String(p.id), '');
    });

    purchases.forEach((purchase) => {
        const pDate = new Date(purchase.date);
        if (isNaN(pDate.getTime())) return;

        (purchase.items || []).forEach((item) => {
            const product = resolveProduct(item);
            if (!product) return;
            const key = String(product.id);
            const qty = Number(item.quantity) || 0;

            if (pDate > cutoffDateTime) {
                stockAdjustments.set(key, (stockAdjustments.get(key) || 0) - qty);
            } else {
                const existing = purchaseDateByProduct.get(key);
                if (!existing || new Date(existing) < pDate) {
                    purchaseDateByProduct.set(key, pDate.toISOString());
                }
            }
        });
    });

    sales.forEach((sale) => {
        const sDate = new Date(sale.date);
        if (isNaN(sDate.getTime()) || sDate <= cutoffDateTime) return;

        (sale.items || []).forEach((item) => {
            const product = resolveProduct(item);
            if (!product) return;
            const key = String(product.id);
            const qty = Number(item.quantity) || 0;
            stockAdjustments.set(key, (stockAdjustments.get(key) || 0) + qty);
        });
    });

    returns.forEach((ret) => {
        const rDate = new Date(ret.date);
        if (isNaN(rDate.getTime()) || rDate <= cutoffDateTime) return;

        const product = resolveProduct(ret);
        if (!product) return;

        const key = String(product.id);
        const qty = Number(ret.quantity) || 0;
        if (qty <= 0) return;

        if (ret.type === 'customer') {
            // Customer return after cutoff increases current stock; remove it for as-of view.
            stockAdjustments.set(key, (stockAdjustments.get(key) || 0) - qty);
        } else if (ret.type === 'supplier') {
            // Supplier return after cutoff decreases current stock; add it back for as-of view.
            stockAdjustments.set(key, (stockAdjustments.get(key) || 0) + qty);
        }
    });

    const rows = [];
    let totalSellValue = 0;
    let totalBuyValue = 0;

    products.forEach((p) => {
        const key = String(p.id);
        const quantityAsOfDate = (Number(p.stock) || 0) + (stockAdjustments.get(key) || 0);
        if (quantityAsOfDate <= 0) return;

        const buyingPrice = Number(p.buyingPrice) || 0;
        const sellPrice = Number(p.price) || 0;
        const buyDateIso = purchaseDateByProduct.get(key);

        totalSellValue += quantityAsOfDate * sellPrice;
        totalBuyValue += quantityAsOfDate * buyingPrice;

        rows.push({
            buyDateIso,
            barcode: p.barcode || '',
            name: p.name || '',
            category: p.category || '',
            quantity: quantityAsOfDate,
            buyingPrice,
            sellPrice
        });
    });

    return { rows, totalSellValue, totalBuyValue };
}

function checkAdminPassword() {
    return requirePermission('settings:write', 'You do not have permission for this action.');
}

function hasPermission(permission) {
    if (!currentUser || !currentUser.role) return false;
    const perms = ROLE_PERMISSIONS[currentUser.role] || [];
    return perms.includes('*') || perms.includes(permission);
}

function requirePermission(permission, message = 'Permission denied') {
    if (!currentUser) {
        showLoginModal();
        return false;
    }
    if (hasPermission(permission)) return true;
    alert(message);
    return false;
}

function showLoginModal() {
    const modal = document.getElementById('login-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    const userEl = document.getElementById('login-username');
    if (userEl) setTimeout(() => userEl.focus(), 50);
}

function hideLoginModal() {
    const modal = document.getElementById('login-modal');
    if (!modal) return;
    modal.classList.add('hidden');
}

function updateCurrentUserDisplay() {
    const display = document.getElementById('current-user-display');
    if (!display) return;

    if (!currentUser) {
        display.textContent = 'Not Logged In';
        display.classList.remove('text-emerald-300');
        display.classList.add('text-yellow-300');
        return;
    }

    display.textContent = `User: ${currentUser.username} (${currentUser.role})`;
    display.classList.remove('text-yellow-300');
    display.classList.add('text-emerald-300');
}

async function handleLogin(event) {
    event.preventDefault();

    const username = document.getElementById('login-username')?.value?.trim();
    const password = document.getElementById('login-password')?.value || '';
    if (!username || !password) {
        alert('Please enter username and password');
        return;
    }

    const user = await DB.users.verify(username, password);
    if (!user) {
        alert('Invalid username or password');
        return;
    }

    currentUser = {
        id: user.id,
        username: user.username,
        role: user.role
    };
    sessionStorage.setItem('sillara-user', JSON.stringify(currentUser));
    hideLoginModal();
    updateCurrentUserDisplay();
}

function logout() {
    currentUser = null;
    sessionStorage.removeItem('sillara-user');
    updateCurrentUserDisplay();
    showLoginModal();
}

async function loadCategories() {
    try {
        // Fetch from categories store
        let categories = await DB.categories.getAll();
        
        // If empty (e.g., first run), try to seed from existing products
        if (categories.length === 0) {
            const allProducts = await DB.products.getAll();
            const uniqueCats = [...new Set(allProducts.map(p => p.category))].filter(Boolean);
            for (const cat of uniqueCats) {
                await DB.categories.add(cat);
            }
            categories = await DB.categories.getAll();
        }

        // Populate selects
        const selects = ['product-category', 'purchase-category'];
        selects.forEach(id => {
            const select = document.getElementById(id);
            if (select) {
                const currentVal = select.value;
                select.innerHTML = '<option value="">Select Category</option>' + 
                    categories.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
                if (currentVal) select.value = currentVal;
            }
        });

        const list = document.getElementById('category-list');
        if (list) {
            list.innerHTML = categories.map(c => `<option value="${c.name}">`).join('');
        }

        // Populate settings list
        const settingsList = document.getElementById('settings-category-list');
        if (settingsList) {
            settingsList.innerHTML = categories.map(c => `
                <div class="flex items-center bg-gray-100 px-3 py-1 rounded-full text-sm border border-gray-200">
                    <span class="mr-2">${c.name}</span>
                    <button onclick="deleteCategory(${c.id})" class="text-red-500 hover:text-red-700">
                        <i class="ri-close-circle-fill"></i>
                    </button>
                </div>
            `).join('');
            
            if (categories.length === 0) {
                settingsList.innerHTML = '<p class="text-sm text-gray-400">No categories added yet.</p>';
            }
        }
    } catch (error) {
        console.error('Error loading categories:', error);
    }
}

async function addNewCategory() {
    const input = document.getElementById('new-category-input');
    const name = input.value.trim();
    if (!name) return;

    if (!checkAdminPassword()) return;
    
    try {
        const id = await DB.categories.add(name);
        input.value = '';
        await loadCategories();
        
        // Auto-select the new category in forms
        const selects = ['product-category', 'purchase-category'];
        selects.forEach(secId => {
            const select = document.getElementById(secId);
            if (select) select.value = name;
        });
    } catch (e) {
        alert('Category might already exist');
    }
}

async function deleteCategory(id) {
    if (!checkAdminPassword()) return;
    if (!confirm('Are you sure you want to delete this category? It will not affect existing products.')) return;
    
    try {
        await DB.categories.delete(id);
        await loadCategories();
    } catch (error) {
        console.error('Error deleting category:', error);
    }
}

// Page Navigation
function showPage(pageName) {
    if (pageName === 'settings' && !requirePermission('settings:read', 'You do not have permission to open settings.')) {
        return;
    }
    if (pageName === 'dayclose' && !requirePermission('dayclose:write', 'Only owner/manager can open day closing.')) {
        return;
    }
    if (pageName === 'parties' && !requirePermission('settings:read', 'You do not have permission to open parties.')) {
        return;
    }
    if (pageName === 'inventory' && !requirePermission('inventory:read', 'You do not have permission to open inventory.')) {
        return;
    }
    if (pageName === 'reports' && !requirePermission('reports:read', 'You do not have permission to open reports.')) {
        return;
    }
    if (pageName === 'expenses' && !requirePermission('expenses:write', 'You do not have permission to open expenses.')) {
        return;
    }
    if (pageName === 'returns') {
        const canOpenReturns = hasPermission('returns:write') || hasPermission('returns:customer');
        if (!canOpenReturns) {
            alert('You do not have permission to open returns.');
            return;
        }
    }

    // Hide all pages
    document.querySelectorAll('.page-content').forEach(page => {
        page.classList.add('hidden');
    });
    
    // Show selected page
    const page = document.getElementById(`page-${pageName}`);
    if (page) {
        page.classList.remove('hidden');
    }
    
    // Update nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    const navBtn = document.getElementById(`nav-${pageName}`);
    if (navBtn) {
        navBtn.classList.add('active');
    }
    
    currentPage = pageName;
    
    // Load page-specific data
    if (pageName === 'dashboard') {
        updateDashboard();
    } else if (pageName === 'pos') {
        displayProducts();
        setTimeout(() => {
            const search = document.getElementById('product-search');
            if (search) search.focus();
        }, 100);
    } else if (pageName === 'inventory') {
        displayInventory();
    } else if (pageName === 'reports') {
        updateReportCurrentStockTotal();
        generateReport();
    } else if (pageName === 'expenses') {
        loadExpensesPage();
    } else if (pageName === 'returns') {
        loadReturnsPage();
    } else if (pageName === 'settings') {
        loadShopSettings();
        loadCategories();
        refreshLedgerSummaryCards();
    } else if (pageName === 'dayclose') {
        loadDayClosingRows();
        updateDayClosePreview();
    } else if (pageName === 'parties') {
        loadPaymentFormOptions();
        loadPartyMasterTables();
        loadLedgerTables();
        loadUnpaidPurchases();
        loadCustomerPaymentStatus();
        loadSupplierPaymentStatus();
        loadPartyMasterDefaults();
        refreshLedgerSummaryCards();
    }
}

async function loadExpensesPage() {
    const today = new Date().toISOString().split('T')[0];
    const monthStart = new Date();
    monthStart.setDate(1);

    const expenseDateEl = document.getElementById('expense-date');
    const fromEl = document.getElementById('expense-from-date');
    const toEl = document.getElementById('expense-to-date');

    if (expenseDateEl && !expenseDateEl.value) expenseDateEl.value = today;
    if (fromEl && !fromEl.value) fromEl.value = monthStart.toISOString().split('T')[0];
    if (toEl && !toEl.value) toEl.value = today;

    await loadExpensesTable();
}

async function setExpenseRange(range) {
    const fromEl = document.getElementById('expense-from-date');
    const toEl = document.getElementById('expense-to-date');
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    let from = today;
    let to = today;

    if (range === 'all') {
        const allExpenses = await DB.expenses.getAll();
        const validDates = allExpenses
            .map(e => new Date(e.date))
            .filter(d => !isNaN(d.getTime()));

        if (validDates.length > 0) {
            const minDate = new Date(Math.min(...validDates.map(d => d.getTime())));
            from = minDate.toISOString().split('T')[0];
        }
    } else if (range === 'thisMonth') {
        from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    }

    if (fromEl) fromEl.value = from;
    if (toEl) toEl.value = to;
    await loadExpensesTable();
}

async function saveExpense(event) {
    event.preventDefault();

    const dateInput = document.getElementById('expense-date').value;
    const category = document.getElementById('expense-category').value;
    const description = document.getElementById('expense-description').value.trim();
    const amount = parseFloat(document.getElementById('expense-amount').value);

    if (!dateInput || !category || !description || isNaN(amount) || amount <= 0) {
        alert('Please fill all expense fields correctly');
        return;
    }

    try {
        await DB.expenses.add({
            date: new Date(`${dateInput}T12:00:00`),
            category,
            description,
            amount
        });

        document.getElementById('expense-form').reset();
        document.getElementById('expense-date').value = new Date().toISOString().split('T')[0];
        await loadExpensesTable();

        if (document.getElementById('report-from-date') && document.getElementById('report-to-date')) {
            await generateReport();
        }

        alert('Expense saved successfully!');
    } catch (error) {
        console.error('Error saving expense:', error);
        alert('Error saving expense. Please try again.');
    }
}

async function loadExpensesTable() {
    const fromDate = document.getElementById('expense-from-date')?.value;
    const toDate = document.getElementById('expense-to-date')?.value;

    let expenses = [];
    if (fromDate && toDate) {
        expenses = await DB.expenses.getByDateRange(fromDate, toDate);
    } else {
        expenses = await DB.expenses.getAll();
    }

    expenses.sort((a, b) => new Date(b.date) - new Date(a.date));

    const tbody = document.getElementById('expense-table-body');
    const total = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    const totalEl = document.getElementById('expense-total');
    const countEl = document.getElementById('expense-record-count');
    if (totalEl) totalEl.textContent = total.toFixed(2);
    if (countEl) countEl.textContent = expenses.length;

    if (!tbody) return;

    if (expenses.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-12 text-gray-400"><i class="ri-wallet-3-line text-5xl mb-3 block"></i><p class="font-sinhala">වියදම් වාර්තා නැත</p><p>No expenses found for selected period</p></td></tr>';
        return;
    }

    tbody.innerHTML = expenses.map(expense => {
        const amount = Number(expense.amount) || 0;
        const amountClass = amount < 0 ? 'text-emerald-600' : 'text-red-600';
        return `
        <tr class="hover:bg-gray-50 transition-colors">
            <td class="px-6 py-4 text-sm text-gray-700 whitespace-nowrap">${formatDateForDisplay(expense.date)}</td>
            <td class="px-6 py-4 text-sm"><span class="badge badge-warning">${expense.category || 'Other'}</span></td>
            <td class="px-6 py-4 text-sm font-medium text-gray-900">${expense.description || ''}</td>
            <td class="px-6 py-4 text-right text-sm font-bold ${amountClass}">Rs. ${amount.toFixed(2)}</td>
            <td class="px-6 py-4 text-sm">
                <button onclick="deleteExpense(${expense.id})" class="text-red-600 hover:text-red-800 p-2 hover:bg-red-50 rounded-lg transition-all">
                    <i class="ri-delete-bin-line"></i> Delete
                </button>
            </td>
        </tr>
    `;
    }).join('');
}

async function deleteExpense(expenseId) {
    if (!confirm('Are you sure you want to delete this expense record?')) {
        return;
    }

    try {
        await DB.expenses.delete(expenseId);
        await loadExpensesTable();

        if (document.getElementById('report-from-date') && document.getElementById('report-to-date')) {
            await generateReport();
        }
    } catch (error) {
        console.error('Error deleting expense:', error);
        alert('Error deleting expense. Please try again.');
    }
}

async function exportExpensesCSV() {
    const fromDate = document.getElementById('expense-from-date')?.value;
    const toDate = document.getElementById('expense-to-date')?.value;

    let expenses = [];
    if (fromDate && toDate) {
        expenses = await DB.expenses.getByDateRange(fromDate, toDate);
    } else {
        expenses = await DB.expenses.getAll();
    }

    expenses.sort((a, b) => new Date(a.date) - new Date(b.date));

    if (expenses.length === 0) {
        alert('No expenses found to export');
        return;
    }

    let csv = 'Date,Category,Description,Amount\n';
    expenses.forEach(expense => {
        const dateStr = formatDateForDisplay(expense.date);
        const category = (expense.category || 'Other').replaceAll('"', '""');
        const description = (expense.description || '').replaceAll('"', '""');
        const amount = (Number(expense.amount) || 0).toFixed(2);
        csv += `${dateStr},"${category}","${description}",${amount}\n`;
    });

    const fromLabel = fromDate || 'all';
    const toLabel = toDate || 'all';
    downloadCSV(csv, `Expenses_${fromLabel}_to_${toLabel}.csv`);
}

async function loadReturnsPage() {
    const today = new Date().toISOString().split('T')[0];
    const monthStart = new Date();
    monthStart.setDate(1);

    const fromEl = document.getElementById('return-from-date');
    const toEl = document.getElementById('return-to-date');
    const customerDateEl = document.getElementById('customer-return-date');
    const supplierDateEl = document.getElementById('supplier-return-date');

    if (fromEl && !fromEl.value) fromEl.value = monthStart.toISOString().split('T')[0];
    if (toEl && !toEl.value) toEl.value = today;
    if (customerDateEl && !customerDateEl.value) customerDateEl.value = today;
    if (supplierDateEl && !supplierDateEl.value) supplierDateEl.value = today;

    const supplierForm = document.getElementById('supplier-return-form');
    const canSupplierReturn = hasPermission('returns:write');
    if (supplierForm) {
        supplierForm.querySelectorAll('input, button, select, textarea').forEach((el) => {
            el.disabled = !canSupplierReturn;
        });
    }

    await loadReturnsTables();
}

function resetCustomerReturnForm() {
    const form = document.getElementById('customer-return-form');
    if (form) form.reset();
    const today = new Date().toISOString().split('T')[0];
    const dateEl = document.getElementById('customer-return-date');
    if (dateEl) dateEl.value = today;

    document.getElementById('customer-return-id').value = '';
    document.getElementById('customer-return-bill-id').value = '';
    document.getElementById('customer-return-bill-item-index').value = '';
    document.getElementById('customer-return-max-qty').value = '';
    document.getElementById('customer-return-name').value = '';
    const billItemSelect = document.getElementById('customer-return-bill-item');
    if (billItemSelect) {
        billItemSelect.innerHTML = '<option value="">Select bill item</option>';
    }
    loadedReturnBill = null;
}

function resetSupplierReturnForm() {
    const form = document.getElementById('supplier-return-form');
    if (form) form.reset();
    const today = new Date().toISOString().split('T')[0];
    const dateEl = document.getElementById('supplier-return-date');
    if (dateEl) dateEl.value = today;
    document.getElementById('supplier-return-id').value = '';
    document.getElementById('supplier-return-name').value = '';
}

async function resolveReturnProduct(ref) {
    if (ref.productId) {
        const byId = await DB.products.getById(Number(ref.productId));
        if (byId) return byId;
    }
    if (ref.barcode) {
        const byBarcode = await DB.products.getByBarcode(ref.barcode);
        if (byBarcode) return byBarcode;
    }
    if (ref.name) {
        const searchResults = await DB.products.search(ref.name);
        const exact = searchResults.find(p => p.name === ref.name);
        if (exact) return exact;
        return searchResults[0] || null;
    }
    return null;
}

async function applyReturnStockEffect(type, product, qty) {
    const currentStock = Number(product.stock) || 0;
    const quantity = Number(qty) || 0;
    if (quantity <= 0) {
        throw new Error('Invalid return quantity');
    }

    if (type === 'customer') {
        await DB.products.update(product.id, { stock: currentStock + quantity });
        return;
    }

    if (type === 'supplier') {
        if (currentStock < quantity) {
            throw new Error(`Not enough stock to return. Available: ${currentStock}`);
        }
        await DB.products.update(product.id, { stock: currentStock - quantity });
        return;
    }

    throw new Error('Unknown return type');
}

async function revertReturnStockEffect(entry) {
    const product = await resolveReturnProduct({
        productId: entry.productId,
        barcode: entry.barcode,
        name: entry.productName
    });

    if (!product) {
        throw new Error('Original product not found to revert stock effect');
    }

    const qty = Number(entry.quantity) || 0;
    const currentStock = Number(product.stock) || 0;

    if (entry.type === 'customer') {
        if (currentStock < qty) {
            throw new Error(`Cannot edit/delete: current stock (${currentStock}) is lower than returned qty (${qty})`);
        }
        await DB.products.update(product.id, { stock: currentStock - qty });
        return;
    }

    if (entry.type === 'supplier') {
        await DB.products.update(product.id, { stock: currentStock + qty });
        return;
    }

    throw new Error('Unknown return type on revert');
}

async function setReturnRange(range) {
    const fromEl = document.getElementById('return-from-date');
    const toEl = document.getElementById('return-to-date');
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    let from = today;
    let to = today;

    if (range === 'all') {
        const allReturns = await DB.returns.getAll();
        const allDates = allReturns
            .map(r => new Date(r.date))
            .filter(d => !isNaN(d.getTime()));
        if (allDates.length > 0) {
            const minDate = new Date(Math.min(...allDates.map(d => d.getTime())));
            from = minDate.toISOString().split('T')[0];
        }
    }

    if (fromEl) fromEl.value = from;
    if (toEl) toEl.value = to;
    await loadReturnsTables();
}

async function exportReturnsCSV() {
    const fromDate = document.getElementById('return-from-date')?.value;
    const toDate = document.getElementById('return-to-date')?.value;

    let returns = [];
    if (fromDate && toDate) {
        returns = await DB.returns.getByDateRange(fromDate, toDate);
    } else {
        returns = await DB.returns.getAll();
    }

    returns.sort((a, b) => new Date(a.date) - new Date(b.date));

    if (returns.length === 0) {
        alert('No return records found to export');
        return;
    }

    let csv = 'Date,Type,Bill No,Supplier,Barcode,Item,Qty,Amount,Reason\n';
    returns.forEach((r) => {
        const date = formatDateForDisplay(r.date);
        const type = (r.type || '').replaceAll('"', '""');
        const billNo = (r.billId || '').toString().replaceAll('"', '""');
        const supplier = (r.supplier || '').replaceAll('"', '""');
        const barcode = (r.barcode || '').replaceAll('"', '""');
        const item = (r.productName || '').replaceAll('"', '""');
        const qty = Number(r.quantity || 0);
        const amount = (Number(r.amount) || 0).toFixed(2);
        const reason = (r.reason || '').replaceAll('"', '""');
        csv += `${date},"${type}","${billNo}","${supplier}","${barcode}","${item}",${qty},${amount},"${reason}"\n`;
    });

    const fromLabel = fromDate || 'all';
    const toLabel = toDate || 'all';
    downloadCSV(csv, `Returns_${fromLabel}_to_${toLabel}.csv`);
}

async function loadBillForReturn() {
    const billNo = parseInt(document.getElementById('customer-return-bill-no').value, 10);
    if (!billNo) {
        alert('Please enter a valid bill number');
        return;
    }

    const sale = await DB.sales.getById(billNo);
    if (!sale) {
        alert('Bill not found');
        loadedReturnBill = null;
        document.getElementById('customer-return-bill-item').innerHTML = '<option value="">Select bill item</option>';
        return;
    }

    loadedReturnBill = sale;
    const select = document.getElementById('customer-return-bill-item');
    const options = (sale.items || []).map((item, index) => {
        const qty = Number(item.quantity || 0);
        const amount = Number(item.total || 0);
        const barcode = item.barcode || '';
        return `<option value="${index}">${item.name} | ${barcode || 'No Barcode'} | Qty: ${qty} | Rs. ${amount.toFixed(2)}</option>`;
    }).join('');

    select.innerHTML = '<option value="">Select bill item</option>' + options;
    document.getElementById('customer-return-bill-id').value = billNo;
    document.getElementById('customer-return-bill-item-index').value = '';
    document.getElementById('customer-return-max-qty').value = '';
}

async function getAllowedCustomerReturnQty(billId, billItemIndex, currentReturnId = 0) {
    const parsedBillId = Number(billId);
    const parsedItemIndex = Number(billItemIndex);
    if (!Number.isInteger(parsedBillId) || parsedBillId <= 0 || !Number.isInteger(parsedItemIndex) || parsedItemIndex < 0) {
        return null;
    }

    const sale = await DB.sales.getById(parsedBillId);
    if (!sale || !Array.isArray(sale.items) || !sale.items[parsedItemIndex]) {
        return null;
    }

    const soldQty = Number(sale.items[parsedItemIndex].quantity) || 0;
    const allReturns = await DB.returns.getAll();
    const alreadyReturned = allReturns
        .filter(r =>
            r.type === 'customer' &&
            Number(r.billId) === parsedBillId &&
            Number(r.billItemIndex) === parsedItemIndex &&
            Number(r.id) !== Number(currentReturnId || 0)
        )
        .reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);

    return Math.max(0, soldQty - alreadyReturned);
}

async function selectBillReturnItem() {
    const select = document.getElementById('customer-return-bill-item');
    const idxStr = select.value;
    if (!loadedReturnBill || idxStr === '') {
        return;
    }

    const idx = Number(idxStr);
    const item = loadedReturnBill.items?.[idx];
    if (!item) return;

    document.getElementById('customer-return-bill-item-index').value = String(idx);
    const billId = Number(document.getElementById('customer-return-bill-id').value || 0);
    const allowedQty = await getAllowedCustomerReturnQty(billId, idx, 0);
    const safeAllowedQty = allowedQty === null ? (Number(item.quantity || 0)) : allowedQty;
    document.getElementById('customer-return-max-qty').value = safeAllowedQty;

    let barcode = item.barcode || '';
    if (!barcode) {
        const productByName = await resolveReturnProduct({ name: item.name });
        if (productByName?.barcode) barcode = productByName.barcode;
    }

    document.getElementById('customer-return-barcode').value = barcode;
    document.getElementById('customer-return-name').value = item.name || '';
    document.getElementById('customer-return-qty').value = safeAllowedQty;
    const unitPrice = (Number(item.quantity || 0) > 0)
        ? ((Number(item.total) || 0) / Number(item.quantity || 1))
        : (Number(item.price) || 0);
    document.getElementById('customer-return-amount').value = (safeAllowedQty * unitPrice).toFixed(2);

    if (safeAllowedQty <= 0) {
        alert('This bill item is already fully returned.');
    }
}

async function handleCustomerReturnBarcode(barcode) {
    const normalized = (barcode || '').trim();
    const nameEl = document.getElementById('customer-return-name');
    if (!normalized) {
        if (nameEl) nameEl.value = '';
        return;
    }

    const product = await DB.products.getByBarcode(normalized);
    if (!product) {
        if (nameEl) nameEl.value = '';
        return;
    }

    if (nameEl) nameEl.value = product.name || '';
    recalcCustomerReturnAmount();
}

async function handleSupplierReturnBarcode(barcode) {
    const normalized = (barcode || '').trim();
    const nameEl = document.getElementById('supplier-return-name');
    if (!normalized) {
        if (nameEl) nameEl.value = '';
        return;
    }

    const product = await DB.products.getByBarcode(normalized);
    if (!product) {
        if (nameEl) nameEl.value = '';
        return;
    }

    if (nameEl) nameEl.value = product.name || '';
    recalcSupplierReturnAmount();
}

async function recalcCustomerReturnAmount() {
    const barcode = document.getElementById('customer-return-barcode')?.value?.trim();
    const qty = parseFloat(document.getElementById('customer-return-qty')?.value || '0');
    const amountEl = document.getElementById('customer-return-amount');
    if (!barcode || !amountEl || qty <= 0) return;

    const product = await DB.products.getByBarcode(barcode);
    if (!product) return;
    amountEl.value = (qty * (Number(product.price) || 0)).toFixed(2);
}

async function recalcSupplierReturnAmount() {
    const barcode = document.getElementById('supplier-return-barcode')?.value?.trim();
    const qty = parseFloat(document.getElementById('supplier-return-qty')?.value || '0');
    const amountEl = document.getElementById('supplier-return-amount');
    if (!barcode || !amountEl || qty <= 0) return;

    const product = await DB.products.getByBarcode(barcode);
    if (!product) return;
    amountEl.value = (qty * (Number(product.buyingPrice) || 0)).toFixed(2);
}

async function saveCustomerReturn(event) {
    event.preventDefault();

    if (!(hasPermission('returns:write') || hasPermission('returns:customer'))) {
        alert('You do not have permission to save customer returns.');
        return;
    }

    const returnId = parseInt(document.getElementById('customer-return-id').value || '0', 10);
    const dateInput = document.getElementById('customer-return-date').value;
    const barcode = document.getElementById('customer-return-barcode').value.trim();
    const qty = parseFloat(document.getElementById('customer-return-qty').value);
    const amount = parseFloat(document.getElementById('customer-return-amount').value);
    const reason = document.getElementById('customer-return-reason').value.trim();
    const billId = parseInt(document.getElementById('customer-return-bill-id').value || '0', 10);
    const billItemIndex = document.getElementById('customer-return-bill-item-index').value;

    if (!dateInput || !barcode || isNaN(qty) || qty <= 0 || isNaN(amount) || amount < 0) {
        alert('Please fill customer return fields correctly');
        return;
    }

    const hasBillItemLink = Number.isInteger(billId) && billId > 0 && billItemIndex !== '' && !Number.isNaN(Number(billItemIndex));
    if (hasBillItemLink) {
        const allowedQty = await getAllowedCustomerReturnQty(billId, Number(billItemIndex), returnId);
        if (allowedQty === null) {
            alert('Selected bill item is invalid. Please reload bill details.');
            return;
        }
        if (qty > allowedQty) {
            alert(`Return qty exceeds allowed qty (${allowedQty}).`);
            return;
        }
    }

    const product = await DB.products.getByBarcode(barcode);
    if (!product) {
        alert('Product not found for this barcode');
        return;
    }

    try {
        const payload = {
            type: 'customer',
            date: new Date(`${dateInput}T12:00:00`),
            productId: product.id,
            barcode: product.barcode || barcode,
            productName: product.name,
            quantity: qty,
            amount,
            buyingPrice: Number(product.buyingPrice) || 0,
            sellingPrice: Number(product.price) || 0,
            reason,
            billId: billId || null,
            billItemIndex: hasBillItemLink ? Number(billItemIndex) : null
        };

        if (returnId > 0) {
            const oldEntry = await DB.returns.getById(returnId);
            if (!oldEntry) {
                alert('Return record not found for editing');
                return;
            }
            await revertReturnStockEffect(oldEntry);
            await applyReturnStockEffect('customer', product, qty);
            await DB.returns.update(returnId, payload);
        } else {
            await applyReturnStockEffect('customer', product, qty);
            await DB.returns.add(payload);
        }

        resetCustomerReturnForm();
        await loadProducts();
        await updateDashboard();
        await loadReturnsTables();
        if (document.getElementById('report-from-date') && document.getElementById('report-to-date')) {
            await generateReport();
        }

        alert(`Customer return ${returnId > 0 ? 'updated' : 'saved'} and stock updated!`);
    } catch (error) {
        console.error('Customer return save error:', error);
        alert(error.message || 'Error saving customer return.');
    }
}

async function saveSupplierReturn(event) {
    event.preventDefault();

    if (!requirePermission('returns:write', 'You do not have permission to save supplier returns.')) return;

    const returnId = parseInt(document.getElementById('supplier-return-id').value || '0', 10);
    const dateInput = document.getElementById('supplier-return-date').value;
    const barcode = document.getElementById('supplier-return-barcode').value.trim();
    const qty = parseFloat(document.getElementById('supplier-return-qty').value);
    const amount = parseFloat(document.getElementById('supplier-return-amount').value);
    const supplier = document.getElementById('supplier-return-supplier').value.trim();
    const reason = document.getElementById('supplier-return-reason').value.trim();

    if (!dateInput || !barcode || isNaN(qty) || qty <= 0 || isNaN(amount) || amount < 0) {
        alert('Please fill supplier return fields correctly');
        return;
    }

    const product = await DB.products.getByBarcode(barcode);
    if (!product) {
        alert('Product not found for this barcode');
        return;
    }

    try {
        const payload = {
            type: 'supplier',
            date: new Date(`${dateInput}T12:00:00`),
            productId: product.id,
            barcode: product.barcode || barcode,
            productName: product.name,
            quantity: qty,
            amount,
            buyingPrice: Number(product.buyingPrice) || 0,
            sellingPrice: Number(product.price) || 0,
            supplier,
            reason
        };

        let finalReturnId = returnId;
        if (returnId > 0) {
            const oldEntry = await DB.returns.getById(returnId);
            if (!oldEntry) {
                alert('Return record not found for editing');
                return;
            }
            await revertReturnStockEffect(oldEntry);
            await applyReturnStockEffect('supplier', product, qty);
            await DB.returns.update(returnId, payload);
        } else {
            await applyReturnStockEffect('supplier', product, qty);
            finalReturnId = await DB.returns.add(payload);
        }

        const supplierRef = await DB.suppliers.getOrCreateByName(supplier || 'Unknown');
        if (supplierRef) {
            const allSupplierLedger = await DB.supplier_ledger.getAll();
            const existingCredit = allSupplierLedger.find(l => l.ref === `supplier-return:${finalReturnId}`);

            if (existingCredit) {
                await DB.supplier_ledger.update(existingCredit.id, {
                    supplierId: supplierRef.id,
                    date: new Date(`${dateInput}T12:00:00`),
                    type: 'credit',
                    amount,
                    note: reason || 'Supplier return credit'
                });
            } else {
                await DB.supplier_ledger.add({
                    supplierId: supplierRef.id,
                    date: new Date(`${dateInput}T12:00:00`),
                    type: 'credit',
                    amount,
                    ref: `supplier-return:${finalReturnId}`,
                    note: reason || 'Supplier return credit'
                });
            }
        }

        resetSupplierReturnForm();
        await loadProducts();
        await updateDashboard();
        await loadReturnsTables();
        await refreshLedgerSummaryCards();
        if (document.getElementById('report-from-date') && document.getElementById('report-to-date')) {
            await generateReport();
        }

        alert(`Supplier return ${returnId > 0 ? 'updated' : 'saved'} and stock updated!`);
    } catch (error) {
        console.error('Supplier return save error:', error);
        alert(error.message || 'Error saving supplier return.');
    }
}

async function editCustomerReturn(returnId) {
    const entry = await DB.returns.getById(returnId);
    if (!entry || entry.type !== 'customer') {
        alert('Customer return record not found');
        return;
    }

    document.getElementById('customer-return-id').value = entry.id;
    const d = new Date(entry.date);
    document.getElementById('customer-return-date').value = isNaN(d.getTime()) ? new Date().toISOString().split('T')[0] : d.toISOString().split('T')[0];
    document.getElementById('customer-return-barcode').value = entry.barcode || '';
    document.getElementById('customer-return-name').value = entry.productName || '';
    document.getElementById('customer-return-qty').value = Number(entry.quantity || 0);
    document.getElementById('customer-return-amount').value = Number(entry.amount || 0).toFixed(2);
    document.getElementById('customer-return-reason').value = entry.reason || '';
    document.getElementById('customer-return-bill-id').value = entry.billId || '';
    document.getElementById('customer-return-bill-item-index').value = entry.billItemIndex ?? '';
    document.getElementById('customer-return-max-qty').value = '';

    const billNoEl = document.getElementById('customer-return-bill-no');
    if (billNoEl && entry.billId) billNoEl.value = entry.billId;
}

async function editSupplierReturn(returnId) {
    const entry = await DB.returns.getById(returnId);
    if (!entry || entry.type !== 'supplier') {
        alert('Supplier return record not found');
        return;
    }

    document.getElementById('supplier-return-id').value = entry.id;
    const d = new Date(entry.date);
    document.getElementById('supplier-return-date').value = isNaN(d.getTime()) ? new Date().toISOString().split('T')[0] : d.toISOString().split('T')[0];
    document.getElementById('supplier-return-barcode').value = entry.barcode || '';
    document.getElementById('supplier-return-name').value = entry.productName || '';
    document.getElementById('supplier-return-qty').value = Number(entry.quantity || 0);
    document.getElementById('supplier-return-amount').value = Number(entry.amount || 0).toFixed(2);
    document.getElementById('supplier-return-supplier').value = entry.supplier || '';
    document.getElementById('supplier-return-reason').value = entry.reason || '';
}

async function deleteCustomerReturn(returnId) {
    if (!confirm('Delete this customer return record?')) return;

    try {
        const entry = await DB.returns.getById(returnId);
        if (!entry || entry.type !== 'customer') {
            alert('Customer return record not found');
            return;
        }

        await revertReturnStockEffect(entry);
        await DB.returns.delete(returnId);
        resetCustomerReturnForm();
        await loadProducts();
        await updateDashboard();
        await loadReturnsTables();
        if (document.getElementById('report-from-date') && document.getElementById('report-to-date')) {
            await generateReport();
        }
    } catch (error) {
        console.error('Delete customer return error:', error);
        alert(error.message || 'Error deleting customer return');
    }
}

async function deleteSupplierReturn(returnId) {
    if (!confirm('Delete this supplier return record?')) return;

    try {
        const entry = await DB.returns.getById(returnId);
        if (!entry || entry.type !== 'supplier') {
            alert('Supplier return record not found');
            return;
        }

        await revertReturnStockEffect(entry);
        await DB.returns.delete(returnId);
        const allSupplierLedger = await DB.supplier_ledger.getAll();
        const linked = allSupplierLedger.filter(l => l.ref === `supplier-return:${returnId}`);
        for (const row of linked) {
            await DB.supplier_ledger.delete(row.id);
        }
        resetSupplierReturnForm();
        await loadProducts();
        await updateDashboard();
        await loadReturnsTables();
        await refreshLedgerSummaryCards();
        if (document.getElementById('report-from-date') && document.getElementById('report-to-date')) {
            await generateReport();
        }
    } catch (error) {
        console.error('Delete supplier return error:', error);
        alert(error.message || 'Error deleting supplier return');
    }
}

async function loadReturnsTables() {
    const fromDate = document.getElementById('return-from-date')?.value;
    const toDate = document.getElementById('return-to-date')?.value;

    let returns = [];
    if (fromDate && toDate) {
        returns = await DB.returns.getByDateRange(fromDate, toDate);
    } else {
        returns = await DB.returns.getAll();
    }

    const customerReturns = returns
        .filter(r => r.type === 'customer')
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    const supplierReturns = returns
        .filter(r => r.type === 'supplier')
        .sort((a, b) => new Date(b.date) - new Date(a.date));

    const customerTotal = customerReturns.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const supplierTotal = supplierReturns.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

    const customerTotalEl = document.getElementById('customer-return-total');
    const supplierTotalEl = document.getElementById('supplier-return-total');
    if (customerTotalEl) customerTotalEl.textContent = customerTotal.toFixed(2);
    if (supplierTotalEl) supplierTotalEl.textContent = supplierTotal.toFixed(2);

    const customerBody = document.getElementById('customer-return-table-body');
    const supplierBody = document.getElementById('supplier-return-table-body');

    if (customerBody) {
        if (customerReturns.length === 0) {
            customerBody.innerHTML = '<tr><td colspan="7" class="px-6 py-8 text-center text-gray-400">No customer returns for selected period</td></tr>';
        } else {
            customerBody.innerHTML = customerReturns.map(r => `
                <tr class="hover:bg-gray-50 transition-colors">
                    <td class="px-6 py-4 text-sm text-gray-600">${formatDateForDisplay(r.date)}</td>
                    <td class="px-6 py-4 text-sm font-mono text-gray-700">${r.barcode || ''}</td>
                    <td class="px-6 py-4 text-sm font-medium text-gray-900">${r.productName || ''}</td>
                    <td class="px-6 py-4 text-right text-sm text-gray-700">${Number(r.quantity || 0)}</td>
                    <td class="px-6 py-4 text-right text-sm font-bold text-amber-700">Rs. ${(Number(r.amount) || 0).toFixed(2)}</td>
                    <td class="px-6 py-4 text-sm text-gray-600">${r.reason || '-'}</td>
                    <td class="px-6 py-4 text-sm whitespace-nowrap">
                        <button onclick="editCustomerReturn(${r.id})" class="text-blue-600 hover:text-blue-800 p-2 hover:bg-blue-50 rounded-lg transition-all">
                            <i class="ri-edit-line"></i>
                        </button>
                        <button onclick="deleteCustomerReturn(${r.id})" class="text-red-600 hover:text-red-800 p-2 hover:bg-red-50 rounded-lg transition-all">
                            <i class="ri-delete-bin-line"></i>
                        </button>
                    </td>
                </tr>
            `).join('');
        }
    }

    if (supplierBody) {
        if (supplierReturns.length === 0) {
            supplierBody.innerHTML = '<tr><td colspan="8" class="px-6 py-8 text-center text-gray-400">No supplier returns for selected period</td></tr>';
        } else {
            supplierBody.innerHTML = supplierReturns.map(r => `
                <tr class="hover:bg-gray-50 transition-colors">
                    <td class="px-6 py-4 text-sm text-gray-600">${formatDateForDisplay(r.date)}</td>
                    <td class="px-6 py-4 text-sm text-gray-700">${r.supplier || '-'}</td>
                    <td class="px-6 py-4 text-sm font-mono text-gray-700">${r.barcode || ''}</td>
                    <td class="px-6 py-4 text-sm font-medium text-gray-900">${r.productName || ''}</td>
                    <td class="px-6 py-4 text-right text-sm text-gray-700">${Number(r.quantity || 0)}</td>
                    <td class="px-6 py-4 text-right text-sm font-bold text-cyan-700">Rs. ${(Number(r.amount) || 0).toFixed(2)}</td>
                    <td class="px-6 py-4 text-sm text-gray-600">${r.reason || '-'}</td>
                    <td class="px-6 py-4 text-sm whitespace-nowrap">
                        <button onclick="editSupplierReturn(${r.id})" class="text-blue-600 hover:text-blue-800 p-2 hover:bg-blue-50 rounded-lg transition-all">
                            <i class="ri-edit-line"></i>
                        </button>
                        <button onclick="deleteSupplierReturn(${r.id})" class="text-red-600 hover:text-red-800 p-2 hover:bg-red-50 rounded-lg transition-all">
                            <i class="ri-delete-bin-line"></i>
                        </button>
                    </td>
                </tr>
            `).join('');
        }
    }
}

// Toggle mobile menu
function toggleMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    menu.classList.toggle('hidden');
}

// Load products from database
async function loadProducts() {
    products = await DB.products.getAll();
}

// Dashboard Functions
async function updateDashboard() {
    // Update stats
    const todaySales = await DB.sales.getTodayTotal();
    const todayTransactions = await DB.sales.getTodayCount();
    const totalProducts = await DB.products.count();
    const lowStockItems = await DB.products.getLowStock();
    
    document.getElementById('today-sales').textContent = todaySales.toFixed(2);
    document.getElementById('today-transactions').textContent = todayTransactions;
    document.getElementById('total-products').textContent = totalProducts;
    document.getElementById('low-stock-count').textContent = lowStockItems.length;
    
    // Display low stock items
    displayLowStockAlerts(lowStockItems);
}

// Display low stock alerts
function displayLowStockAlerts(items) {
    const container = document.getElementById('low-stock-list');
    
    if (items.length === 0) {
        container.innerHTML = `
            <div class="text-center text-gray-400 py-8">
                <i class="ri-checkbox-circle-line text-5xl mb-2"></i>
                <p class="font-sinhala">තොග හොඳයි</p>
                <p class="text-sm">All stocks are healthy</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = items.map(item => `
        <div class="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded-xl pulse-animation">
            <div class="flex-1">
                <p class="font-semibold text-gray-900">${item.name}</p>
                <p class="text-sm text-gray-600">
                    Stock: ${item.stock} ${item.type === 'weight' ? 'kg' : 'units'}
                    <span class="text-red-600 ml-2">⚠ Low!</span>
                </p>
            </div>
            <button onclick="showEditProductModal(${item.id})" class="bg-primary-500 text-white px-3 py-1 rounded-lg text-sm hover:bg-primary-600">
                <i class="ri-add-line"></i> Add Stock
            </button>
        </div>
    `).join('');
}

// POS Functions
async function displayProducts(searchQuery = '') {
    products = searchQuery ? 
        await DB.products.search(searchQuery) : 
        await DB.products.filterByCategory(currentFilter);
    
    const grid = document.getElementById('products-grid');
    
    if (products.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full text-center py-12 text-gray-400">
                <i class="ri-inbox-line text-6xl mb-4"></i>
                <p class="font-sinhala">භාණ්ඩ නැත</p>
                <p>No products found</p>
            </div>
        `;
        return;
    }
    
    grid.innerHTML = products.map(product => {
        const isOutOfStock = product.stock <= 0;
        const isLowStock = product.stock <= (product.minStock || 5) && product.stock > 0;
        
        return `
            <div class="product-card ${isOutOfStock ? 'out-of-stock' : ''}" 
                 onclick="${isOutOfStock ? '' : `showQuantityModal(${product.id})`}">
                <div class="text-center">
                    <div class="bg-gradient-to-br from-primary-100 to-primary-200 w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-3">
                        <i class="ri-shopping-bag-line text-3xl text-primary-700"></i>
                    </div>
                    
                    <h4 class="font-semibold text-gray-900 mb-1 text-sm line-clamp-2">${product.name}</h4>
                    <p class="text-xs text-gray-500 mb-2">${product.category}</p>
                    
                    <div class="mt-2">
                        <p class="text-lg font-bold text-primary-600">Rs. ${product.price.toFixed(2)}</p>
                        <p class="text-xs text-gray-500">per ${product.type === 'weight' ? 'kg' : 'unit'}</p>
                    </div>
                    
                    <div class="mt-2">
                        ${isOutOfStock ? 
                            '<span class="badge badge-danger text-xs">Out of Stock</span>' :
                            isLowStock ?
                            `<span class="badge badge-warning text-xs">Low: ${product.stock}</span>` :
                            `<span class="badge badge-success text-xs">Stock: ${product.stock}</span>`
                        }
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Search products
function searchProducts(query) {
    displayProducts(query);
}

// Search products with Barcode support
async function handleSearchKeydown(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        const query = event.target.value.trim();
        
        if (!query) return;

        // Try to find by exact barcode match first
        const productByBarcode = await DB.products.getByBarcode(query);
        
        if (productByBarcode) {
            // Found by barcode! Add to cart immediately
            if (productByBarcode.stock <= 0) {
                alert(`Out of Stock: ${productByBarcode.name}`);
                event.target.value = '';
                return;
            }
            
            // If unit type, add 1. If weight, show modal?
            // For speed, let's just add 1 unit/kg and let user edit quantity if needed
            // Or better: show quantity modal for weight, auto-add for unit
            
            if (productByBarcode.type === 'weight') {
                showQuantityModal(productByBarcode.id);
            } else {
                addToCart(productByBarcode, 1);
                // Visual feedback
                const notification = document.createElement('div');
                notification.className = 'fixed bottom-4 right-4 bg-green-500 text-white px-6 py-3 rounded-xl shadow-lg transform transition-all duration-500 z-50 flex items-center gap-2';
                notification.innerHTML = `<i class="ri-check-line text-xl"></i> Added ${productByBarcode.name}`;
                document.body.appendChild(notification);
                setTimeout(() => {
                    notification.style.opacity = '0';
                    setTimeout(() => notification.remove(), 500);
                }, 2000);
            }
            
            event.target.value = ''; // Clear search
            displayProducts(''); // Reset grid
        }
    }
}

// Add Item Helper
function addToCart(product, quantity) {
    // Check if product already in cart
    const existingItem = cart.find(item => item.productId === product.id);
    
    if (existingItem) {
        if (existingItem.quantity + quantity > product.stock) {
            alert(`Not enough stock! Available: ${product.stock}`);
            return;
        }
        existingItem.quantity += quantity;
        existingItem.total = existingItem.quantity * existingItem.price;
    } else {
        if (quantity > product.stock) {
            alert(`Not enough stock! Available: ${product.stock}`);
            return;
        }
        cart.push({
            productId: product.id,
            barcode: product.barcode,
            name: product.name,
            price: product.price,
            buyingPrice: product.buyingPrice || 0,
            quantity: quantity,
            type: product.type,
            total: product.price * quantity
        });
    }
    updateCart();
}

// Filter by category
function filterByCategory(event, category) {
    currentFilter = category;
    
    // Update active button
    document.querySelectorAll('.category-filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    if (event?.target?.closest) {
        const btn = event.target.closest('.category-filter-btn');
        if (btn) btn.classList.add('active');
    } else {
        const fallbackBtn = document.querySelector(`.category-filter-btn[data-category="${category}"]`);
        if (fallbackBtn) fallbackBtn.classList.add('active');
    }
    
    displayProducts();
}

// Quantity Modal
function showQuantityModal(productId) {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    
    document.getElementById('qty-product-id').value = product.id;
    document.getElementById('qty-product-name').textContent = product.name;
    document.getElementById('qty-product-type').textContent = 
        `Price: Rs. ${product.price} per ${product.type === 'weight' ? 'kg' : 'unit'}`;
    
    const label = product.type === 'weight' ? 'Weight (kg)' : 'Quantity';
    document.getElementById('qty-label').textContent = label;
    
    document.getElementById('quantity-input').value = '';
    document.getElementById('quantity-modal').classList.remove('hidden');
    
    // Focus on input
    setTimeout(() => {
        document.getElementById('quantity-input').focus();
    }, 100);
}

function closeQuantityModal() {
    document.getElementById('quantity-modal').classList.add('hidden');
}

// Add to cart with quantity
function addToCartWithQuantity(event) {
    event.preventDefault();
    
    const productId = parseInt(document.getElementById('qty-product-id').value);
    const quantity = parseFloat(document.getElementById('quantity-input').value);
    
    const product = products.find(p => p.id === productId);
    if (!product) return;
    
    addToCart(product, quantity);
    closeQuantityModal();
    
    // If it was from barcode scan (search box might still have text?)
    // Actually, usually quantity modal is from click.
    // If from barcode, we might want to clear search.
    const searchInput = document.getElementById('product-search');
    if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
    }
}

// Update cart display
function updateCart() {
    const cartContainer = document.getElementById('cart-items');
    
    if (cart.length === 0) {
        cartContainer.innerHTML = `
            <div class="text-center text-gray-400 py-12">
                <i class="ri-shopping-cart-line text-6xl mb-4"></i>
                <p class="font-sinhala">බිල්පත හිස්</p>
                <p class="text-sm">Add items to cart</p>
            </div>
        `;
        document.getElementById('cart-subtotal').textContent = '0.00';
        document.getElementById('cart-total').textContent = '0.00';
        document.getElementById('cash-tendered').value = '';
        document.getElementById('cart-balance').textContent = '0.00';
        return;
    }
    
    cartContainer.innerHTML = cart.map((item, index) => `
        <div class="cart-item">
            <div class="flex-1">
                <p class="font-semibold text-gray-900 text-sm">${item.name}</p>
                <p class="text-xs text-gray-600">
                    ${item.quantity} ${item.type === 'weight' ? 'kg' : 'units'} × Rs. ${item.price.toFixed(2)}
                </p>
            </div>
            <div class="text-right">
                <p class="font-bold text-gray-900">Rs. ${item.total.toFixed(2)}</p>
                <button onclick="removeFromCart(${index})" class="cart-item-remove">
                    <i class="ri-delete-bin-line"></i>
                </button>
            </div>
        </div>
    `).join('');
    
    const total = cart.reduce((sum, item) => sum + item.total, 0);
    document.getElementById('cart-subtotal').textContent = total.toFixed(2);
    document.getElementById('cart-total').textContent = total.toFixed(2);
    calculateBalance();
}

function calculateBalance() {
    const total = parseFloat(document.getElementById('cart-total').textContent) || 0;
    const tendered = parseFloat(document.getElementById('cash-tendered').value) || 0;
    const balance = tendered > 0 ? tendered - total : 0;
    
    const balanceEl = document.getElementById('cart-balance');
    if (balanceEl) {
        balanceEl.textContent = balance.toFixed(2);
        // Highlight in red if tendered is less than total
        if (tendered > 0 && tendered < total) {
            balanceEl.parentElement.classList.add('text-red-500');
            balanceEl.parentElement.classList.remove('text-accent-600');
        } else {
            balanceEl.parentElement.classList.remove('text-red-500');
            balanceEl.parentElement.classList.add('text-accent-600');
        }
    }
}

function toggleCreditSaleFields() {
    const box = document.getElementById('is-credit-sale');
    const section = document.getElementById('credit-sale-fields');
    const tenderedEl = document.getElementById('cash-tendered');
    const codeEl = document.getElementById('credit-customer-code');
    const nameEl = document.getElementById('credit-customer-name');
    const phoneEl = document.getElementById('credit-customer-phone');
    if (!box || !section) return;

    const enabled = !!box.checked;
    section.classList.toggle('hidden', !enabled);

    if (codeEl) {
        codeEl.required = enabled;
        if (!enabled) codeEl.value = '';
    }
    if (nameEl) {
        nameEl.required = false;
        if (!enabled) nameEl.value = '';
    }
    if (phoneEl && !enabled) phoneEl.value = '';

    // Credit sale default behavior: start as full due; cashier can still enter partial payment if needed.
    if (enabled && tenderedEl && !tenderedEl.value) {
        tenderedEl.value = '0';
    }

    calculateBalance();
    if (enabled && codeEl) {
        setTimeout(() => codeEl.focus(), 60);
    }
}

async function handlePosCreditCustomerSelect() {
    const selectedId = Number(document.getElementById('pos-credit-customer-select')?.value || 0);
    const codeEl = document.getElementById('credit-customer-code');
    const nameEl = document.getElementById('credit-customer-name');
    const phoneEl = document.getElementById('credit-customer-phone');
    if (!codeEl || !nameEl || !phoneEl) return;

    if (!selectedId) {
        return;
    }

    const customers = await DB.customers.getAll();
    const customer = customers.find((c) => Number(c.id) === selectedId);
    if (!customer) return;

    codeEl.value = customer.code || '';
    nameEl.value = customer.name || '';
    phoneEl.value = customer.phone || '';
}

async function handleCreditCustomerCodeLookup() {
    const codeEl = document.getElementById('credit-customer-code');
    const nameEl = document.getElementById('credit-customer-name');
    const phoneEl = document.getElementById('credit-customer-phone');
    if (!codeEl || !nameEl || !phoneEl) return;

    const code = codeEl.value.trim();
    if (!code) return;
    const customer = await DB.customers.getByCode(code);
    if (customer) {
        const selectEl = document.getElementById('pos-credit-customer-select');
        if (selectEl && selectEl.querySelector(`option[value="${customer.id}"]`)) {
            selectEl.value = String(customer.id);
        }
        nameEl.value = customer.name || '';
        phoneEl.value = customer.phone || '';
    }
}

// Remove from cart
function removeFromCart(index) {
    cart.splice(index, 1);
    updateCart();
}

// Clear cart
function clearCart() {
    if (cart.length === 0) return;
    
    if (confirm('Clear all items from cart?')) {
        cart = [];
        updateCart();
    }
}

// Complete sale
async function completeSale() {
    if (cart.length === 0) {
        alert('Cart is empty! Add items first.');
        return;
    }

    if (!requirePermission('pos:sale', 'You do not have permission to complete sales.')) return;
    
    try {
        // Calculate total
        const totalAmount = cart.reduce((sum, item) => sum + item.total, 0);
        const tendered = parseFloat(document.getElementById('cash-tendered').value) || 0;
        const balance = tendered > 0 ? tendered - totalAmount : 0;
        const isCredit = !!document.getElementById('is-credit-sale')?.checked;
        const creditCustomerCode = document.getElementById('credit-customer-code')?.value?.trim() || '';
        const creditCustomerName = document.getElementById('credit-customer-name')?.value?.trim() || '';
        const creditCustomerPhone = document.getElementById('credit-customer-phone')?.value?.trim() || '';

        if (isCredit && !creditCustomerCode) {
            alert('Please enter customer number/code for credit sale');
            return;
        }

        if (isCredit && creditCustomerCode) {
            const existingByCode = await DB.customers.getByCode(creditCustomerCode);
            if (!existingByCode && !creditCustomerName) {
                alert('Customer code not found. Please enter customer name to create new customer.');
                document.getElementById('credit-customer-name')?.focus();
                return;
            }
        }

        if (isCredit && tendered >= totalAmount) {
            alert('Credit sale selected, but no due amount exists. Reduce Cash Tendered to create receivable.');
            document.getElementById('cash-tendered')?.focus();
            return;
        }

        // Create sale record
        const sale = {
            totalAmount,
            cashTendered: tendered,
            balance: balance,
            items: cart.map(item => ({
                barcode: item.barcode || '',
                name: item.name,
                quantity: item.quantity,
                price: item.price,
                buyingPrice: item.buyingPrice || 0,
                total: item.total
            }))
        };
        
        // Save to database
        const saleId = await DB.sales.add(sale);

        const dueAmount = Math.max(0, totalAmount - Math.max(0, tendered));
        let creditSaved = false;
        if (dueAmount > 0 && (isCredit || creditCustomerCode || creditCustomerName)) {
            const customer = creditCustomerCode
                ? await DB.customers.getOrCreateByCode(creditCustomerCode, creditCustomerName, creditCustomerPhone)
                : await DB.customers.getOrCreateByName(creditCustomerName || 'Walk-in Credit', creditCustomerPhone);
            if (customer) {
                await DB.customer_ledger.add({
                    customerId: customer.id,
                    date: new Date(),
                    type: 'sale',
                    amount: dueAmount,
                    ref: `sale:${saleId}`,
                    note: `Credit from bill #${saleId}`
                });
                creditSaved = true;
            }
        }
        
        // Update stock
        for (const item of cart) {
            const product = await DB.products.getById(item.productId);
            await DB.products.update(item.productId, {
                stock: product.stock - item.quantity
            });
        }
        
        // Show receipt
        showReceipt(saleId, sale);
        
        // Clear cart
        cart = [];
        updateCart();
        const isCreditEl = document.getElementById('is-credit-sale');
        const creditCodeEl = document.getElementById('credit-customer-code');
        const creditNameEl = document.getElementById('credit-customer-name');
        const creditPhoneEl = document.getElementById('credit-customer-phone');
        if (isCreditEl) isCreditEl.checked = false;
        if (creditCodeEl) creditCodeEl.value = '';
        if (creditNameEl) creditNameEl.value = '';
        if (creditPhoneEl) creditPhoneEl.value = '';
        toggleCreditSaleFields();
        
        // Reload products
        await loadProducts();
        await updateDashboard();
        await refreshLedgerSummaryCards();
        displayProducts();

        if (creditSaved) {
            alert(`Credit saved for ${creditCustomerName || 'customer'}: Rs. ${dueAmount.toFixed(2)}`);
        }
        
    } catch (error) {
        console.error('Sale error:', error);
        alert('Error completing sale. (දෝෂයක් සිදුවිය!)');
    }
}

// Show receipt
async function showReceipt(saleId, sale) {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB');
    const timeStr = now.toLocaleTimeString('en-GB');
    
    // Get shop settings
    const shopSettings = await DB.shop_settings.get();
    
    const receiptContent = `
        <div class="receipt-header">
            <div class="receipt-title">${shopSettings.name}</div>
            ${shopSettings.phone ? `<div class="receipt-info">Tel: ${shopSettings.phone}</div>` : ''}
            ${shopSettings.address ? `<div class="receipt-info">${shopSettings.address}</div>` : ''}
            ${shopSettings.info ? `<div class="receipt-info" style="font-size: 0.75rem;">${shopSettings.info}</div>` : ''}
            <div class="receipt-info" style="margin-top: 0.5rem; border-top: 1px dashed #d1d5db; padding-top: 0.5rem;">
                Bill #: ${saleId}<br>
                Date: ${dateStr}<br>
                Time: ${timeStr}
            </div>
        </div>
        
        <div class="receipt-items">
            <table style="width: 100%; font-size: 0.875rem;">
                <thead>
                    <tr style="border-bottom: 1px dashed #d1d5db;">
                        <th style="text-align: left; padding-bottom: 0.5rem;">Item</th>
                        <th style="text-align: right; padding-bottom: 0.5rem;">Qty</th>
                        <th style="text-align: right; padding-bottom: 0.5rem;">Price</th>
                        <th style="text-align: right; padding-bottom: 0.5rem;">Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${sale.items.map(item => `
                        <tr>
                            <td style="padding: 0.25rem 0;">${item.name}</td>
                            <td style="text-align: right;">${item.quantity}</td>
                            <td style="text-align: right;">${item.price.toFixed(2)}</td>
                            <td style="text-align: right;">${item.total.toFixed(2)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        
        <div class="receipt-total" style="padding-bottom: 0;">
            <span>TOTAL:</span>
            <span>Rs. ${sale.totalAmount.toFixed(2)}</span>
        </div>

        ${sale.cashTendered > 0 ? `
        <div class="receipt-total" style="padding: 0.25rem 0; border-top: none; font-size: 0.9rem;">
            <span>Cash Tendered:</span>
            <span>Rs. ${sale.cashTendered.toFixed(2)}</span>
        </div>
        <div class="receipt-total" style="padding-top: 0; border-top: none; font-size: 0.9rem;">
            <span>Balance:</span>
            <span>Rs. ${sale.balance.toFixed(2)}</span>
        </div>
        ` : ''}
        
        <div class="receipt-footer">
            Thank you!<br>
            ස්තූතියි!<br>
            <br>
            Powered by Sillara-POS DNW
        </div>
    `;
    
    document.getElementById('receipt-content').innerHTML = receiptContent;
    document.getElementById('receipt-modal').classList.remove('hidden');
}

function closeReceiptModal() {
    document.getElementById('receipt-modal').classList.add('hidden');
}
async function displayInventory() {
    const products = await DB.products.getAll();
    const tbody = document.getElementById('inventory-table-body');
    
    if (products.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center py-12 text-gray-400">
                    <i class="ri-inbox-line text-6xl mb-4 block"></i>
                    <p class="font-sinhala">භාණ්ඩ නැත</p>
                    <p>No products in inventory</p>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = products.map(product => {
        const isLowStock = product.stock <= (product.minStock || 5);
        const isOutOfStock = product.stock <= 0;
        
        let statusBadge;
        if (isOutOfStock) {
            statusBadge = '<span class="badge badge-danger">Out of Stock</span>';
        } else if (isLowStock) {
            statusBadge = '<span class="badge badge-warning">Low Stock</span>';
        } else {
            statusBadge = '<span class="badge badge-success">In Stock</span>';
        }
        
        return `
            <tr>
                <td class="font-semibold text-gray-900">
                    ${product.name}
                    ${product.barcode ? `<br><span class="text-xs text-gray-400 font-mono">${product.barcode}</span>` : ''}
                </td>
                <td><span class="text-sm text-gray-600">${product.category}</span></td>
                <td><span class="text-sm text-gray-600 capitalize">${product.type}</span></td>
                <td class="font-semibold text-primary-600">Rs. ${product.price.toFixed(2)}</td>
                <td class="font-semibold ${isLowStock ? 'text-red-600' : 'text-gray-900'}">
                    ${product.stock} ${product.type === 'weight' ? 'kg' : 'units'}
                </td>
                <td>${statusBadge}</td>
                <td>
                    <div class="flex gap-2">
                        <button onclick="showEditProductModal(${product.id})" 
                                class="text-blue-600 hover:text-blue-800 p-2 hover:bg-blue-50 rounded-lg transition-all">
                            <i class="ri-edit-line"></i>
                        </button>
                        <button onclick="deleteProduct(${product.id})" 
                                class="text-red-600 hover:text-red-800 p-2 hover:bg-red-50 rounded-lg transition-all">
                            <i class="ri-delete-bin-line"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// Product Modal Functions
function showAddProductModal() {
    document.getElementById('modal-title').textContent = 'Add New Product';
    document.getElementById('product-form').reset();
    document.getElementById('product-id').value = '';
    document.getElementById('product-modal').classList.remove('hidden');
}

async function showEditProductModal(productId) {
    const product = await DB.products.getById(productId);
    if (!product) return;
    
    document.getElementById('modal-title').textContent = 'Edit Product';
    document.getElementById('product-id').value = product.id;
    document.getElementById('product-name').value = product.name;
    document.getElementById('product-barcode').value = product.barcode || '';
    document.getElementById('product-category').value = product.category;
    document.getElementById('product-type').value = product.type;
    document.getElementById('product-buying-price').value = product.buyingPrice || '';
    document.getElementById('product-price').value = product.price;
    document.getElementById('product-stock').value = product.stock;
    document.getElementById('product-min-stock').value = product.minStock || 5;
    
    document.getElementById('product-modal').classList.remove('hidden');
    // Focus on barcode input for quick editing
    setTimeout(() => document.getElementById('product-barcode').focus(), 100);
}

function closeProductModal() {
    document.getElementById('product-modal').classList.add('hidden');
}

// Save product
async function saveProduct(event) {
    event.preventDefault();
    if (!requirePermission('inventory:write', 'You do not have permission to save products.')) return;
    
    const productId = document.getElementById('product-id').value;
    const buyingPriceVal = document.getElementById('product-buying-price').value;

    const productData = {
        name: document.getElementById('product-name').value,
        barcode: document.getElementById('product-barcode').value.trim(),
        category: document.getElementById('product-category').value,
        type: document.getElementById('product-type').value,
        buyingPrice: buyingPriceVal ? parseFloat(buyingPriceVal) : 0,
        price: parseFloat(document.getElementById('product-price').value),
        stock: parseFloat(document.getElementById('product-stock').value),
        minStock: parseFloat(document.getElementById('product-min-stock').value) || 5
    };
    
    try {
        if (productId) {
            // Update existing product
            await DB.products.update(parseInt(productId), productData);
        } else {
            // Add new product
            await DB.products.add(productData);
        }
        
        closeProductModal();
        await loadProducts();
        displayInventory();
        updateDashboard();
        
        alert(`Product ${productId ? 'updated' : 'added'} successfully!`);
    } catch (error) {
        console.error('Save product error:', error);
        alert('Error saving product. Please try again.');
    }
}

// Delete product
async function deleteProduct(productId) {
    if (!requirePermission('inventory:write', 'You do not have permission to delete products.')) return;
    if (!confirm('Are you sure you want to delete this product?')) {
        return;
    }
    
    try {
        await DB.products.delete(productId);
        await loadProducts();
        displayInventory();
        updateDashboard();
        alert('Product deleted successfully!');
    } catch (error) {
        console.error('Delete product error:', error);
        alert('Error deleting product. Please try again.');
    }
}

// Reports Functions
async function setReportRange(range) {
    const fromDateEl = document.getElementById('report-from-date');
    const toDateEl = document.getElementById('report-to-date');
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    
    let from = today;
    let to = today;
    
    if (range === 'all') {
        const [allSales, allPurchases, allExpenses, allReturns] = await Promise.all([
            DB.sales.getAll(),
            DB.purchases.getAll(),
            DB.expenses.getAll(),
            DB.returns.getAll()
        ]);

        const allDates = [
            ...allSales.map(s => s.date),
            ...allPurchases.map(p => p.date),
            ...allExpenses.map(e => e.date),
            ...allReturns.map(r => r.date)
        ]
            .filter(Boolean)
            .map(d => new Date(d))
            .filter(d => !isNaN(d.getTime()));

        if (allDates.length > 0) {
            const earliestDate = new Date(Math.min(...allDates.map(d => d.getTime())));
            from = earliestDate.toISOString().split('T')[0];
        }
    } else if (range === 'yesterday') {
        const yesterday = new Date();
        yesterday.setDate(now.getDate() - 1);
        from = yesterday.toISOString().split('T')[0];
        to = from;
    } else if (range === 'thisMonth') {
        from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    } else if (range === 'lastMonth') {
        from = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];
        to = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];
    } else if (range === 'thisYear') {
        from = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
    }
    
    fromDateEl.value = from;
    toDateEl.value = to;
    generateReport();
}

async function generateReport() {
    await updateReportCurrentStockTotal();

    const fromDate = document.getElementById('report-from-date').value;
    const toDate = document.getElementById('report-to-date').value;
    
    if (!fromDate || !toDate) {
        alert('Please select both from and to dates');
        return;
    }
    
    // --- 1. SALES REPORT ---
    const sales = await DB.sales.getByDateRange(fromDate, toDate);
    
    const returns = await DB.returns.getByDateRange(fromDate, toDate);
    const customerReturns = returns.filter(r => r.type === 'customer');
    const supplierReturns = returns.filter(r => r.type === 'supplier');

    // Stats
    const grossSales = sales.reduce((sum, sale) => sum + sale.totalAmount, 0);
    const totalTransactions = sales.length;
    const totalCustomerReturnAmount = customerReturns.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const totalSupplierReturnAmount = supplierReturns.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const netSales = grossSales - totalCustomerReturnAmount;
    const avgBill = totalTransactions > 0 ? netSales / totalTransactions : 0;
    
    // Profit Logic
    const grossCost = sales.reduce((sum, sale) => {
        const saleCost = sale.items.reduce((isum, item) => {
            const itemBuyingPrice = item.buyingPrice || 0;
            return isum + (itemBuyingPrice * item.quantity);
        }, 0);
        return sum + saleCost;
    }, 0);

    const customerReturnCost = customerReturns.reduce((sum, r) => {
        const unitCost = Number(r.buyingPrice) || 0;
        const qty = Number(r.quantity) || 0;
        return sum + (unitCost * qty);
    }, 0);
    
    const netCost = Math.max(0, grossCost - customerReturnCost - totalSupplierReturnAmount);
    const grossProfit = netSales - netCost;
    const margin = netSales > 0 ? (grossProfit / netSales) * 100 : 0;
    
    // Update Stats UI
    document.getElementById('report-total-sales').textContent = netSales.toFixed(2);
    document.getElementById('report-total-profit').innerHTML = 
        `${grossProfit.toFixed(2)} <span class="text-sm font-normal opacity-80">(${margin.toFixed(1)}%)</span>`;
    document.getElementById('report-total-transactions').textContent = totalTransactions;
    document.getElementById('report-avg-bill').textContent = avgBill.toFixed(2);

    const reportCustomerReturns = document.getElementById('report-customer-returns');
    const reportSupplierReturns = document.getElementById('report-supplier-returns');
    if (reportCustomerReturns) reportCustomerReturns.textContent = totalCustomerReturnAmount.toFixed(2);
    if (reportSupplierReturns) reportSupplierReturns.textContent = totalSupplierReturnAmount.toFixed(2);
    
    // Top Products Logic
    const productStats = {};
    sales.forEach(sale => {
        sale.items.forEach(item => {
            if (!productStats[item.name]) productStats[item.name] = { qty: 0, revenue: 0 };
            productStats[item.name].qty += item.quantity;
            productStats[item.name].revenue += item.total;
        });
    });

    customerReturns.forEach(r => {
        if (!r.productName || !productStats[r.productName]) return;
        productStats[r.productName].qty = Math.max(0, productStats[r.productName].qty - (Number(r.quantity) || 0));
        productStats[r.productName].revenue = Math.max(0, productStats[r.productName].revenue - (Number(r.amount) || 0));
    });
    
    const topProducts = Object.entries(productStats)
        .map(([name, stats]) => ({ name, ...stats }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5);
        
    const topProductsList = document.getElementById('report-top-products');
    if (topProducts.length === 0) {
        topProductsList.innerHTML = '<p class="text-gray-400 text-center py-4">No sales data found</p>';
    } else {
        topProductsList.innerHTML = topProducts.map((p, i) => `
            <div class="flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors">
                <div class="flex items-center gap-3">
                    <span class="w-8 h-8 flex items-center justify-center bg-primary-100 text-primary-600 rounded-full font-bold text-sm">${i+1}</span>
                    <span class="font-medium text-gray-700">${p.name}</span>
                </div>
                <div class="text-right">
                    <p class="font-bold text-gray-900">${p.qty} <span class="text-xs font-normal text-gray-500">sold</span></p>
                    <p class="text-xs text-gray-500">Rs. ${p.revenue.toFixed(2)}</p>
                </div>
            </div>
        `).join('');
    }

    // Sales Table
    const tbody = document.getElementById('sales-report-table-body');
    if (sales.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-12 text-gray-400"><i class="ri-file-list-line text-6xl mb-4 block"></i><p class="font-sinhala">විකුණුම් නැත</p><p>No sales found for selected period</p></td></tr>`;
    } else {
        tbody.innerHTML = sales.reverse().map(sale => {
            const date = new Date(sale.date);
            const dateStr = date.toLocaleDateString('en-GB');
            const timeStr = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            return `
                <tr>
                    <td class="font-semibold text-primary-600">#${sale.id}</td>
                    <td><div>${dateStr}</div><div class="text-xs text-gray-500">${timeStr}</div></td>
                    <td><div class="text-sm text-gray-600">${sale.items.length} item${sale.items.length > 1 ? 's' : ''}</div></td>
                    <td class="font-bold text-gray-900">Rs. ${sale.totalAmount.toFixed(2)}</td>
                    <td><button onclick="viewSaleDetails(${sale.id})" class="text-blue-600 hover:text-blue-800 p-2 hover:bg-blue-50 rounded-lg transition-all"><i class="ri-eye-line"></i> View</button></td>
                </tr>
            `;
        }).join('');
    }

    // --- 2. INCOME STATEMENT ---
    const expenses = await DB.expenses.getByDateRange(fromDate, toDate);
    const totalExpenses = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const netProfit = grossProfit - totalExpenses;

    const grossSalesEl = document.getElementById('is-gross-sales');
    const customerReturnsEl = document.getElementById('is-customer-returns');
    const cogsGrossEl = document.getElementById('is-cogs-gross');
    const customerReturnCostEl = document.getElementById('is-customer-return-cost');

    if (grossSalesEl) grossSalesEl.textContent = grossSales.toFixed(2);
    if (customerReturnsEl) customerReturnsEl.textContent = totalCustomerReturnAmount.toFixed(2);
    if (cogsGrossEl) cogsGrossEl.textContent = grossCost.toFixed(2);
    if (customerReturnCostEl) customerReturnCostEl.textContent = customerReturnCost.toFixed(2);

    document.getElementById('is-revenue').textContent = netSales.toFixed(2);
    document.getElementById('is-cogs').textContent = netCost.toFixed(2);
    document.getElementById('is-gross-profit').textContent = grossProfit.toFixed(2);
    document.getElementById('is-expenses').textContent = totalExpenses.toFixed(2);
    const supplierReturnEl = document.getElementById('is-supplier-returns');
    if (supplierReturnEl) supplierReturnEl.textContent = totalSupplierReturnAmount.toFixed(2);
    document.getElementById('is-net-profit').textContent = netProfit.toFixed(2);

    const expenseTableBody = document.getElementById('report-expense-table-body');
    const reportExpenseTotal = document.getElementById('report-expense-total');
    if (reportExpenseTotal) {
        reportExpenseTotal.textContent = totalExpenses.toFixed(2);
    }

    const expenseCategoryBody = document.getElementById('report-expense-category-body');
    const expenseByCategory = expenses.reduce((map, expense) => {
        const key = expense.category || 'Other';
        map[key] = (map[key] || 0) + (Number(expense.amount) || 0);
        return map;
    }, {});

    const expenseCategoryRows = Object.entries(expenseByCategory)
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount);

    if (expenseCategoryBody) {
        if (expenseCategoryRows.length === 0) {
            expenseCategoryBody.innerHTML = '<tr><td colspan="3" class="px-6 py-8 text-center text-gray-400">No expense categories for selected period</td></tr>';
        } else {
            expenseCategoryBody.innerHTML = expenseCategoryRows.map((row) => {
                const share = totalExpenses > 0 ? (row.amount / totalExpenses) * 100 : 0;
                return `
                    <tr class="hover:bg-gray-50 transition-colors">
                        <td class="px-6 py-4 text-sm font-medium text-gray-900">${row.category}</td>
                        <td class="px-6 py-4 text-sm text-right font-bold text-red-600">Rs. ${row.amount.toFixed(2)}</td>
                        <td class="px-6 py-4 text-sm text-right text-gray-700">${share.toFixed(1)}%</td>
                    </tr>
                `;
            }).join('');
        }
    }

    const [customerLedgerAll, supplierLedgerAll, customersAll, suppliersAll] = await Promise.all([
        DB.customer_ledger.getAll(),
        DB.supplier_ledger.getAll(),
        DB.customers.getAll(),
        DB.suppliers.getAll()
    ]);

    const customerNameById = new Map(customersAll.map(c => [Number(c.id), c.name || `Customer #${c.id}`]));
    const supplierNameById = new Map(suppliersAll.map(s => [Number(s.id), s.name || `Supplier #${s.id}`]));

    const customerInPeriod = customerLedgerAll.filter((e) => {
        const key = dateKeyOf(e.date);
        return key >= fromDate && key <= toDate;
    });
    const supplierInPeriod = supplierLedgerAll.filter((e) => {
        const key = dateKeyOf(e.date);
        return key >= fromDate && key <= toDate;
    });

    const receivablePeriod = customerInPeriod.reduce((sum, e) => sum + customerLedgerImpact(e), 0);
    const payablePeriod = supplierInPeriod.reduce((sum, e) => sum + supplierLedgerImpact(e), 0);

    const receivableOutstanding = customerLedgerAll
        .filter((e) => dateKeyOf(e.date) <= toDate)
        .reduce((sum, e) => sum + customerLedgerImpact(e), 0);
    const payableOutstanding = supplierLedgerAll
        .filter((e) => dateKeyOf(e.date) <= toDate)
        .reduce((sum, e) => sum + supplierLedgerImpact(e), 0);

    const receivableOutstandingEl = document.getElementById('report-receivable-outstanding');
    const receivablePeriodEl = document.getElementById('report-receivable-period');
    const payableOutstandingEl = document.getElementById('report-payable-outstanding');
    const payablePeriodEl = document.getElementById('report-payable-period');
    if (receivableOutstandingEl) receivableOutstandingEl.textContent = receivableOutstanding.toFixed(2);
    if (receivablePeriodEl) receivablePeriodEl.textContent = receivablePeriod.toFixed(2);
    if (payableOutstandingEl) payableOutstandingEl.textContent = payableOutstanding.toFixed(2);
    if (payablePeriodEl) payablePeriodEl.textContent = payablePeriod.toFixed(2);

    const reportCustomerLedgerBody = document.getElementById('report-customer-ledger-body');
    const reportSupplierLedgerBody = document.getElementById('report-supplier-ledger-body');

    if (reportCustomerLedgerBody) {
        const sorted = [...customerInPeriod].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 200);
        if (sorted.length === 0) {
            reportCustomerLedgerBody.innerHTML = '<tr><td colspan="5" class="px-6 py-8 text-center text-gray-400">No customer ledger entries in selected period</td></tr>';
        } else {
            reportCustomerLedgerBody.innerHTML = sorted.map((entry) => {
                const impact = customerLedgerImpact(entry);
                const impactClass = impact >= 0 ? 'text-amber-700' : 'text-emerald-700';
                return `
                    <tr class="hover:bg-gray-50 transition-colors">
                        <td class="px-6 py-4 text-sm text-gray-600">${formatDateForDisplay(entry.date)}</td>
                        <td class="px-6 py-4 text-sm text-gray-900">${customerNameById.get(Number(entry.customerId)) || '-'}</td>
                        <td class="px-6 py-4 text-sm text-gray-700">${entry.type || ''}</td>
                        <td class="px-6 py-4 text-sm text-gray-600">${entry.ref || entry.note || '-'}</td>
                        <td class="px-6 py-4 text-right text-sm font-bold ${impactClass}">${impact >= 0 ? '+' : ''}${impact.toFixed(2)}</td>
                    </tr>
                `;
            }).join('');
        }
    }

    if (reportSupplierLedgerBody) {
        const sorted = [...supplierInPeriod].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 200);
        if (sorted.length === 0) {
            reportSupplierLedgerBody.innerHTML = '<tr><td colspan="5" class="px-6 py-8 text-center text-gray-400">No supplier ledger entries in selected period</td></tr>';
        } else {
            reportSupplierLedgerBody.innerHTML = sorted.map((entry) => {
                const impact = supplierLedgerImpact(entry);
                const impactClass = impact >= 0 ? 'text-rose-700' : 'text-emerald-700';
                return `
                    <tr class="hover:bg-gray-50 transition-colors">
                        <td class="px-6 py-4 text-sm text-gray-600">${formatDateForDisplay(entry.date)}</td>
                        <td class="px-6 py-4 text-sm text-gray-900">${supplierNameById.get(Number(entry.supplierId)) || '-'}</td>
                        <td class="px-6 py-4 text-sm text-gray-700">${entry.type || ''}</td>
                        <td class="px-6 py-4 text-sm text-gray-600">${entry.ref || entry.note || '-'}</td>
                        <td class="px-6 py-4 text-right text-sm font-bold ${impactClass}">${impact >= 0 ? '+' : ''}${impact.toFixed(2)}</td>
                    </tr>
                `;
            }).join('');
        }
    }

    lastIncomeStatement = {
        fromDate,
        toDate,
        grossSales,
        totalCustomerReturnAmount,
        netSales,
        grossCost,
        totalSupplierReturnAmount,
        customerReturnCost,
        netCost,
        grossProfit,
        totalExpenses,
        netProfit,
        expenseCategoryRows,
        receivableOutstanding,
        payableOutstanding
    };

    const reportCustomerReturnBody = document.getElementById('report-customer-return-body');
    const reportSupplierReturnBody = document.getElementById('report-supplier-return-body');

    if (reportCustomerReturnBody) {
        if (customerReturns.length === 0) {
            reportCustomerReturnBody.innerHTML = '<tr><td colspan="5" class="px-6 py-8 text-center text-gray-400">No customer returns for selected period</td></tr>';
        } else {
            const rows = [...customerReturns]
                .sort((a, b) => new Date(b.date) - new Date(a.date))
                .map(r => `
                    <tr class="hover:bg-gray-50 transition-colors">
                        <td class="px-6 py-4 text-sm text-gray-600">${formatDateForDisplay(r.date)}</td>
                        <td class="px-6 py-4 text-sm font-mono text-gray-700">${r.barcode || ''}</td>
                        <td class="px-6 py-4 text-sm font-medium text-gray-900">${r.productName || ''}</td>
                        <td class="px-6 py-4 text-right text-sm text-gray-700">${Number(r.quantity || 0)}</td>
                        <td class="px-6 py-4 text-right text-sm font-bold text-amber-700">Rs. ${(Number(r.amount) || 0).toFixed(2)}</td>
                    </tr>
                `).join('');
            reportCustomerReturnBody.innerHTML = rows;
        }
    }

    if (reportSupplierReturnBody) {
        if (supplierReturns.length === 0) {
            reportSupplierReturnBody.innerHTML = '<tr><td colspan="5" class="px-6 py-8 text-center text-gray-400">No supplier returns for selected period</td></tr>';
        } else {
            const rows = [...supplierReturns]
                .sort((a, b) => new Date(b.date) - new Date(a.date))
                .map(r => `
                    <tr class="hover:bg-gray-50 transition-colors">
                        <td class="px-6 py-4 text-sm text-gray-600">${formatDateForDisplay(r.date)}</td>
                        <td class="px-6 py-4 text-sm font-mono text-gray-700">${r.barcode || ''}</td>
                        <td class="px-6 py-4 text-sm font-medium text-gray-900">${r.productName || ''}</td>
                        <td class="px-6 py-4 text-right text-sm text-gray-700">${Number(r.quantity || 0)}</td>
                        <td class="px-6 py-4 text-right text-sm font-bold text-cyan-700">Rs. ${(Number(r.amount) || 0).toFixed(2)}</td>
                    </tr>
                `).join('');
            reportSupplierReturnBody.innerHTML = rows;
        }
    }

    if (expenseTableBody) {
        if (expenses.length === 0) {
            expenseTableBody.innerHTML = '<tr><td colspan="4" class="px-6 py-8 text-center text-gray-400">No expense entries for selected period</td></tr>';
        } else {
            const sortedExpenses = [...expenses].sort((a, b) => new Date(b.date) - new Date(a.date));
            expenseTableBody.innerHTML = sortedExpenses.map((expense) => {
                const amount = Number(expense.amount) || 0;
                const amountClass = amount < 0 ? 'text-emerald-600' : 'text-red-600';
                return `
                <tr class="hover:bg-gray-50 transition-colors">
                    <td class="px-6 py-4 text-sm text-gray-600 whitespace-nowrap">${formatDateForDisplay(expense.date)}</td>
                    <td class="px-6 py-4 text-sm text-gray-700">${expense.category || 'Other'}</td>
                    <td class="px-6 py-4 text-sm font-medium text-gray-900">${expense.description || ''}</td>
                    <td class="px-6 py-4 text-right text-sm font-bold ${amountClass}">Rs. ${amount.toFixed(2)}</td>
                </tr>
            `;
            }).join('');
        }
    }

    // --- 3. PURCHASE HISTORY ---
    const purchases = await DB.purchases.getByDateRange(fromDate, toDate);
    const purchaseTbody = document.getElementById('purchase-history-body');
    if (purchases.length === 0) {
        purchaseTbody.innerHTML = '<tr><td colspan="6" class="px-6 py-4 text-center text-gray-400">No purchases found for this period</td></tr>';
    } else {
        const rows = [];
        purchases.reverse().forEach(p => {
            const d = new Date(p.date);
            const dateStr = d.toLocaleDateString();
            
            p.items.forEach(item => {
                const bPrice = item.buyingPrice || item.cost || 0;
                const sPrice = item.sellingPrice || 0;
                rows.push(`
                    <tr class="hover:bg-gray-50 transition-colors">
                        <td class="px-6 py-4 text-xs text-gray-500 whitespace-nowrap">${dateStr}</td>
                        <td class="px-6 py-4 text-xs text-gray-700 font-medium">${p.supplier}</td>
                        <td class="px-6 py-4 text-sm">
                            <div class="font-bold text-gray-900">${item.name}</div>
                            <div class="text-[10px] text-gray-500">${item.quantity} ${item.type === 'weight' ? 'kg' : 'pcs'}</div>
                        </td>
                        <td class="px-6 py-4 text-right text-sm font-semibold text-blue-600">Rs. ${bPrice.toFixed(2)}</td>
                        <td class="px-6 py-4 text-right text-sm font-semibold text-green-600">Rs. ${sPrice.toFixed(2)}</td>
                        <td class="px-6 py-4 text-right text-sm font-bold text-gray-900">Rs. ${(bPrice * item.quantity).toFixed(2)}</td>
                    </tr>
                `);
            });
        });
        purchaseTbody.innerHTML = rows.join('');
    }
}

async function exportIncomeStatementCSV() {
    const fromDate = document.getElementById('report-from-date')?.value;
    const toDate = document.getElementById('report-to-date')?.value;

    if (!fromDate || !toDate) {
        alert('Please select report date range first');
        return;
    }

    if (!lastIncomeStatement || lastIncomeStatement.fromDate !== fromDate || lastIncomeStatement.toDate !== toDate) {
        await generateReport();
    }

    if (!lastIncomeStatement) {
        alert('Unable to prepare income statement data');
        return;
    }

    let csv = 'Section,Item,Amount\n';
    csv += `Period,From Date,${lastIncomeStatement.fromDate}\n`;
    csv += `Period,To Date,${lastIncomeStatement.toDate}\n`;
    csv += '\n';

    csv += `Revenue,Gross Sales,${lastIncomeStatement.grossSales.toFixed(2)}\n`;
    csv += `Revenue,Less Customer Returns,-${lastIncomeStatement.totalCustomerReturnAmount.toFixed(2)}\n`;
    csv += `Revenue,Net Sales,${lastIncomeStatement.netSales.toFixed(2)}\n`;
    csv += '\n';

    csv += `COGS,COGS Gross,${lastIncomeStatement.grossCost.toFixed(2)}\n`;
    csv += `COGS,Less Supplier Return Credit,-${lastIncomeStatement.totalSupplierReturnAmount.toFixed(2)}\n`;
    csv += `COGS,Less Customer Return Cost (Stock Back Value),-${lastIncomeStatement.customerReturnCost.toFixed(2)}\n`;
    csv += `COGS,Net COGS,${lastIncomeStatement.netCost.toFixed(2)}\n`;
    csv += '\n';

    csv += `Profit,Gross Profit,${lastIncomeStatement.grossProfit.toFixed(2)}\n`;
    csv += `Expenses,Total Other Expenses,${lastIncomeStatement.totalExpenses.toFixed(2)}\n`;
    csv += `Profit,Net Profit,${lastIncomeStatement.netProfit.toFixed(2)}\n`;
    csv += '\n';

    csv += 'Expense Category Breakdown,,\n';
    csv += 'Category,Amount,Share\n';
    if (lastIncomeStatement.expenseCategoryRows.length === 0) {
        csv += 'No categories,0.00,0%\n';
    } else {
        lastIncomeStatement.expenseCategoryRows.forEach((row) => {
            const share = lastIncomeStatement.totalExpenses > 0 ? (row.amount / lastIncomeStatement.totalExpenses) * 100 : 0;
            const escapedCategory = row.category.replaceAll('"', '""');
            csv += `"${escapedCategory}",${row.amount.toFixed(2)},${share.toFixed(1)}%\n`;
        });
    }

    downloadCSV(csv, `Income_Statement_${fromDate}_to_${toDate}.csv`);
}

async function exportSalesCSV() {
    const fromDate = document.getElementById('report-from-date').value;
    const toDate = document.getElementById('report-to-date').value;
    
    if (!fromDate || !toDate) {
        alert('Please select both from and to dates first');
        return;
    }
    
    const sales = await DB.sales.getByDateRange(fromDate, toDate);
    
    if (sales.length === 0) {
        alert('No sales found for the selected period');
        return;
    }

    const allProducts = await DB.products.getAll();
    const categoryByProductId = new Map(allProducts.map(p => [p.id, p.category || '']));
    const categoryByBarcode = new Map(allProducts.map(p => [p.barcode || '', p.category || '']));
    const categoryByName = new Map(allProducts.map(p => [p.name || '', p.category || '']));
    
    let csv = "Date,Bill No,Barcode,Item Name,Category,Quantity,Buying Price,Sell Price,Total\n";
    
    for (const sale of sales) {
        const d = new Date(sale.date);
        const dateStr = d.toLocaleDateString('en-GB');
        
        for (const item of sale.items) {
            let barcode = item.barcode;
            let buyingPrice = item.buyingPrice || 0;
            let category = item.category || '';

            // Fallback for old data without barcode/buying price stored in sale record
            if ((!barcode || !buyingPrice) && item.productId) {
                const p = await DB.products.getById(item.productId);
                if (p) {
                    if (!barcode) barcode = p.barcode;
                    if (!buyingPrice) buyingPrice = p.buyingPrice || 0;
                    if (!category) category = p.category || '';
                }
            }

            if (!category && item.productId) category = categoryByProductId.get(item.productId) || '';
            if (!category && barcode) category = categoryByBarcode.get(barcode) || '';
            if (!category && item.name) category = categoryByName.get(item.name) || '';

            csv += `${dateStr},${sale.id},"${barcode || ''}","${item.name}","${category}",${item.quantity},${buyingPrice.toFixed(2)},${item.price.toFixed(2)},${item.total.toFixed(2)}\n`;
        }
    }
    
    downloadCSV(csv, `Sales_Report_${fromDate}_to_${toDate}.csv`);
}

async function exportPurchasesCSV() {
    const fromDate = document.getElementById('report-from-date').value;
    const toDate = document.getElementById('report-to-date').value;
    
    if (!fromDate || !toDate) {
        alert('Please select both from and to dates first');
        return;
    }
    
    const purchases = await DB.purchases.getByDateRange(fromDate, toDate);
    
    if (purchases.length === 0) {
        alert('No purchases found for the selected period');
        return;
    }

    const allProducts = await DB.products.getAll();
    const categoryByProductId = new Map(allProducts.map(p => [p.id, p.category || '']));
    const categoryByBarcode = new Map(allProducts.map(p => [p.barcode || '', p.category || '']));
    const categoryByName = new Map(allProducts.map(p => [p.name || '', p.category || '']));
    
    let csv = "Date,Item Name,Barcode,Category,Quantity,Buy Price,Sell Price,Total Cost\n";
    
    for (const p of purchases) {
        const d = new Date(p.date);
        const dateStr = d.toLocaleDateString('en-GB');
        
        for (const item of p.items) {
            let barcode = item.barcode;
            const bp = item.buyingPrice || item.cost || 0;
            let sp = item.sellingPrice || 0;
            let category = item.category || '';

            // Fallback for old data
            if ((!barcode || !sp) && item.productId) {
                const prod = await DB.products.getById(item.productId);
                if (prod) {
                    if (!barcode) barcode = prod.barcode;
                    if (!sp) sp = prod.price || 0;
                    if (!category) category = prod.category || '';
                }
            }

            if (!category && item.productId) category = categoryByProductId.get(item.productId) || '';
            if (!category && barcode) category = categoryByBarcode.get(barcode) || '';
            if (!category && item.name) category = categoryByName.get(item.name) || '';

            csv += `${dateStr},"${item.name}","${barcode || ''}","${category}",${item.quantity},${bp.toFixed(2)},${sp.toFixed(2)},${(item.total || (bp * item.quantity)).toFixed(2)}\n`;
        }
    }
    
    downloadCSV(csv, `Purchase_Report_${fromDate}_to_${toDate}.csv`);
}

async function exportStockCSV() {
    const cutoffDateTime = getStockCutoffDateTimeFromReport();
    if (!cutoffDateTime) {
        alert('Please select a valid date');
        return;
    }

    const formatDate = (value) => {
        const d = new Date(value);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleDateString('en-GB');
    };

    const snapshot = await buildStockSnapshot(cutoffDateTime);
    if (snapshot.rows.length === 0) {
        alert('No products in stock to export');
        return;
    }

    let csv = "Date,Barcode,Item Name,Category,Quantity,Buying Price,Sell Price\n";

    snapshot.rows.forEach((row) => {
        const buyDate = row.buyDateIso ? formatDate(row.buyDateIso) : '';
        csv += `"${buyDate}","${row.barcode}","${row.name}","${row.category}",${row.quantity},${row.buyingPrice.toFixed(2)},${row.sellPrice.toFixed(2)}\n`;
    });

    const fileDate = cutoffDateTime.toISOString().split('T')[0];
    downloadCSV(csv, `Stock_As_Of_${fileDate}.csv`);
}

function downloadCSV(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Purchase / Receive Stock Logic
// Purchase / Receive Stock Logic
function showReceiveStockModal() {
    if (!requirePermission('inventory:write', 'You do not have permission to receive stock.')) return;
    console.log('Opening Receive Stock Modal...');
    try {
        purchaseCart = [];
        
        // Element Validation
        const supplierEl = document.getElementById('purchase-supplier');
        if (!supplierEl) throw new Error('Supplier input missing');
        supplierEl.value = '';
        const supplierCodeEl = document.getElementById('purchase-supplier-code');
        if (supplierCodeEl) supplierCodeEl.value = '';

        const dateEl = document.getElementById('purchase-date');
        if (!dateEl) throw new Error('Date input missing');
        dateEl.value = new Date().toISOString().split('T')[0];
        
        // Reset Add Item Form
        const barcodeEl = document.getElementById('purchase-barcode');
        if (!barcodeEl) throw new Error('Barcode input missing');
        barcodeEl.value = '';

        document.getElementById('purchase-name').value = '';
        document.getElementById('purchase-product-id').value = '';
        document.getElementById('purchase-is-new').value = 'true';
        document.getElementById('purchase-category').value = '';
        document.getElementById('purchase-type').value = 'unit';
        document.getElementById('purchase-qty').value = '';
        document.getElementById('purchase-cost').value = '';
        document.getElementById('purchase-price').value = '';
        document.getElementById('purchase-free-item').checked = false;
        
        const tbody = document.getElementById('purchase-items-body');
        if (!tbody) throw new Error('Table body missing');
        tbody.innerHTML = '';

        const totalEl = document.getElementById('purchase-total');
        if (!totalEl) throw new Error('Total element missing');
        totalEl.textContent = '0.00';
        
        // Check DB
        if (typeof DB === 'undefined' || !DB.products) {
             console.error('DB not initialized');
             alert('Database error. Please refresh page.');
             return;
        }

        // Load Categories for Autocomplete
        loadCategories();
        
        const modal = document.getElementById('receive-stock-modal');
        if (!modal) throw new Error('Modal missing');
        modal.classList.remove('hidden');
        
        setTimeout(() => {
            if (barcodeEl) barcodeEl.focus();
        }, 100);

    } catch (error) {
        console.error('Error opening modal:', error);
        alert('Error: ' + error.message);
    }
}

function closeReceiveStockModal() {
    document.getElementById('receive-stock-modal').classList.add('hidden');
}

async function handlePurchaseSupplierCodeLookup() {
    const code = document.getElementById('purchase-supplier-code')?.value?.trim() || '';
    const supplierNameEl = document.getElementById('purchase-supplier');
    const supplierSelect = document.getElementById('purchase-supplier-select');
    if (!code || !supplierNameEl) return;
    const supplier = await DB.suppliers.getByCode(code);
    if (supplier) {
        supplierNameEl.value = supplier.name || '';
        if (supplierSelect && supplierSelect.querySelector(`option[value="${supplier.id}"]`)) {
            supplierSelect.value = String(supplier.id);
        }
    }
}

async function handlePurchaseSupplierSelect() {
    const supplierId = Number(document.getElementById('purchase-supplier-select')?.value || 0);
    const supplierNameEl = document.getElementById('purchase-supplier');
    const supplierCodeEl = document.getElementById('purchase-supplier-code');
    if (!supplierNameEl || !supplierCodeEl) return;

    if (!supplierId) {
        return;
    }

    const suppliers = await DB.suppliers.getAll();
    const supplier = suppliers.find((s) => Number(s.id) === supplierId);
    if (!supplier) return;

    supplierNameEl.value = supplier.name || '';
    supplierCodeEl.value = supplier.code || '';
}



// Barcode Handler (Debounced or on Enter)
let purchaseBarcodeTimeout;
async function handlePurchaseBarcode(barcode) {
    if (!barcode || barcode.length < 3) return;
    
    clearTimeout(purchaseBarcodeTimeout);
    purchaseBarcodeTimeout = setTimeout(async () => {
        const product = await DB.products.getByBarcode(barcode);
        
        if (product) {
            // Found: Populate fields and set to "Update" mode
            document.getElementById('purchase-product-id').value = product.id;
            document.getElementById('purchase-is-new').value = 'false';
            
            document.getElementById('purchase-name').value = product.name;
            document.getElementById('purchase-category').value = product.category;
            document.getElementById('purchase-type').value = product.type;
            document.getElementById('purchase-cost').value = product.buyingPrice || '';
            document.getElementById('purchase-price').value = product.price || '';
            
            // Move focus to quantity
            document.getElementById('purchase-qty').focus();
        } else {
            // Not Found: Switch to "New" mode but keep barcode
            document.getElementById('purchase-product-id').value = '';
            document.getElementById('purchase-is-new').value = 'true';
            
            // Should we clear other fields? Probably yes to avoid confusion with previous search
            document.getElementById('purchase-name').value = '';
            document.getElementById('purchase-cost').value = '';
            document.getElementById('purchase-price').value = '';
        }
    }, 400);
}



async function handlePurchaseBarcodeEnter(barcode) {
    if (!barcode) return;
    
    const product = await DB.products.getByBarcode(barcode);
    
    if (product) {
        // Found: Populate and set Update Mode
        selectPurchaseProduct(product.id);
    } else {
        // Not Found: New Mode
        // Don't clear barcode, let user fill the rest
        document.getElementById('purchase-product-id').value = '';
        document.getElementById('purchase-is-new').value = 'true';
        document.getElementById('purchase-name').focus();
    }
}

async function searchPurchaseProducts(query) {
    // If user types, we reset to "New" mode unless they pick a result
    document.getElementById('purchase-product-id').value = '';
    document.getElementById('purchase-is-new').value = 'true';
    
    const resultsContainer = document.getElementById('purchase-search-results');
    if (!query || query.length < 2) {
        resultsContainer.innerHTML = '';
        resultsContainer.classList.add('hidden');
        return;
    }
    
    const results = await DB.products.search(query);
    
    if (results.length === 0) {
       resultsContainer.innerHTML = '<div class="p-3 text-sm text-gray-500">No product found</div>';
    } else {
        resultsContainer.innerHTML = results.slice(0, 10).map(p => `
            <div class="p-3 hover:bg-gray-100 cursor-pointer border-b" onclick="selectPurchaseProduct(${p.id})">
                <div class="font-bold text-gray-800">${p.name}</div>
                <div class="text-xs text-gray-500">${p.barcode} | Stock: ${p.stock}</div>
            </div>
        `).join('');
    }
    resultsContainer.classList.remove('hidden');
}

async function selectPurchaseProduct(productId) {
    const product = await DB.products.getById(productId);
    if (!product) return;
    
    document.getElementById('purchase-product-id').value = product.id;
    document.getElementById('purchase-is-new').value = 'false';
    
    document.getElementById('purchase-barcode').value = product.barcode;
    document.getElementById('purchase-name').value = product.name;
    document.getElementById('purchase-category').value = product.category;
    document.getElementById('purchase-type').value = product.type;
    document.getElementById('purchase-cost').value = product.buyingPrice || '';
    document.getElementById('purchase-price').value = product.price || '';
    document.getElementById('purchase-min-stock').value = product.minStock || 5;

    // Notify if current stock is low
    if (product.stock <= (product.minStock || 5)) {
        showNotification(`Current Stock is Low! (${product.stock} ${product.type === 'weight' ? 'kg' : 'units'} left) \n (දැනට තොග අඩුයි!)`, 'warning');
    }
    
    document.getElementById('purchase-search-results').classList.add('hidden');
    document.getElementById('purchase-qty').focus();
}

async function addPurchaseItem() {
    const idVal = document.getElementById('purchase-product-id').value;
    const productId = idVal ? parseInt(idVal) : null;
    const isNew = !productId;
    
    const barcode = document.getElementById('purchase-barcode').value;
    const name = document.getElementById('purchase-name').value;
    const category = document.getElementById('purchase-category').value;
    const type = document.getElementById('purchase-type').value;
    const qty = parseFloat(document.getElementById('purchase-qty').value);
    const minStock = parseFloat(document.getElementById('purchase-min-stock').value) || 5;
    const costInput = parseFloat(document.getElementById('purchase-cost').value);
    const priceInput = parseFloat(document.getElementById('purchase-price').value);
    const isFree = document.getElementById('purchase-free-item').checked;
    
    // Validation
    if (!name || isNaN(qty) || isNaN(priceInput)) {
        alert('Please fill Name, Selling Price and Quantity');
        return;
    }
    
    const cost = isFree ? 0 : (isNaN(costInput) ? 0 : costInput);
    
    if (isNew) {
        if (!barcode || !category) {
            alert('New Products require Barcode and Category');
            return;
        }
        // Duplicate Barcode/Price Check
        const existing = await DB.products.getByBarcodeAndPrice(barcode, priceInput);
        if (existing) {
            alert(`Barcode already exists for another product.`);
            return;
        }
    }
    
    purchaseCart.push({
        productId,
        isNew,
        barcode,
        name,
        category,
        type,
        quantity: qty,
        minStock,
        buyingPrice: cost,
        sellingPrice: priceInput,
        isFree,
        total: cost * qty
    });
    
    updatePurchaseTable();
    
    // Clear Form for next item
    document.getElementById('purchase-barcode').value = '';
    document.getElementById('purchase-name').value = '';
    document.getElementById('purchase-product-id').value = '';
    document.getElementById('purchase-is-new').value = 'true';
    document.getElementById('purchase-category').value = '';
    document.getElementById('purchase-qty').value = '';
    document.getElementById('purchase-min-stock').value = '';
    document.getElementById('purchase-cost').value = '';
    document.getElementById('purchase-price').value = '';
    const expDateEl = document.getElementById('purchase-exp-date');
    if (expDateEl) expDateEl.value = '';
    document.getElementById('purchase-free-item').checked = false;
    document.getElementById('purchase-barcode').focus();
}

function updatePurchaseTable() {
    const tbody = document.getElementById('purchase-items-body');
    const totalEl = document.getElementById('purchase-total');
    
    if (purchaseCart.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-gray-400">No items added</td></tr>';
        totalEl.textContent = '0.00';
        return;
    }
    
    tbody.innerHTML = purchaseCart.map((item, index) => `
        <tr>
            <td class="px-4 py-2 text-sm">
                <div class="font-bold text-gray-800">${item.name}</div>
                <div class="text-xs text-gray-500">${item.barcode} ${item.isNew ? '<span class="text-green-600 font-bold">(NEW)</span>' : ''}</div>
            </td>
            <td class="px-4 py-2 text-sm text-right font-mono">${item.sellingPrice.toFixed(2)}</td>
            <td class="px-4 py-2 text-sm text-right">${item.quantity}</td>
            <td class="px-4 py-2 text-sm text-right text-gray-600">${item.buyingPrice.toFixed(2)}</td>
            <td class="px-4 py-2 text-sm text-right font-bold">${item.total.toFixed(2)}</td>
            <td class="px-4 py-2 text-center">
                <button onclick="removePurchaseItem(${index})" class="text-red-500 hover:text-red-700"><i class="ri-delete-bin-line"></i></button>
            </td>
        </tr>
    `).join('');
    
    const total = purchaseCart.reduce((sum, item) => sum + item.total, 0);
    totalEl.textContent = total.toFixed(2);
}

function removePurchaseItem(index) {
    purchaseCart.splice(index, 1);
    updatePurchaseTable();
}

async function savePurchase() {
    if (!requirePermission('inventory:write', 'You do not have permission to save purchases.')) return;

    if (purchaseCart.length === 0) {
        alert('Please add items first');
        return;
    }
    
    const supplierCode = document.getElementById('purchase-supplier-code')?.value?.trim() || '';
    const supplier = document.getElementById('purchase-supplier').value;
    const date = document.getElementById('purchase-date').value;
    const expDate = document.getElementById('purchase-exp-date')?.value || '';
    
    if (!date) {
        alert('Please select date');
        return;
    }
    if (!supplierCode) {
        alert('Please enter supplier number/code');
        return;
    }
    const existingSupplier = await DB.suppliers.getByCode(supplierCode);
    if (!existingSupplier && !(supplier || '').trim()) {
        alert('Supplier code not found. Please enter supplier name to create new supplier.');
        document.getElementById('purchase-supplier')?.focus();
        return;
    }
    
    try {
        const totalCost = purchaseCart.reduce((sum, item) => sum + item.total, 0);
        
        // 1. Process Products (Update or Create)
        const finalItems = [];
        
        for (const item of purchaseCart) {
            let pId = item.productId;
            
            if (item.isNew) {
                // Create New Product
                pId = await DB.products.add({
                    barcode: item.barcode,
                    name: item.name,
                    category: item.category,
                    type: item.type,
                    price: item.sellingPrice,
                    buyingPrice: item.buyingPrice,
                    stock: item.quantity,
                    minStock: item.minStock
                });
            } else {
                // Update Existing Product or Create New Price Batch
                const originalProduct = await DB.products.getById(pId);
                
                if (originalProduct) {
                    if (originalProduct.price === item.sellingPrice) {
                        // Same Price: Update stock of this specific row
                        const updateData = {
                            stock: originalProduct.stock + item.quantity
                        };
                        // Update Buying Price if not free
                        if (!item.isFree && item.buyingPrice > 0) {
                            updateData.buyingPrice = item.buyingPrice;
                        }
                        // Sync Name/Category/MinStock updates if any changed in form
                        updateData.name = item.name;
                        updateData.category = item.category;
                        updateData.minStock = item.minStock;
                        
                        await DB.products.update(pId, updateData);
                    } else {
                        // Different Price: Check if another batch with this price exists
                        const existingBatch = await DB.products.getByBarcodeAndPrice(item.barcode, item.sellingPrice);
                        
                        if (existingBatch) {
                            // Found another row with same barcode AND same NEW price: Update it
                            const updateData = {
                                stock: existingBatch.stock + item.quantity
                            };
                            if (!item.isFree && item.buyingPrice > 0) {
                                updateData.buyingPrice = item.buyingPrice;
                            }
                            await DB.products.update(existingBatch.id, updateData);
                            pId = existingBatch.id; // Update pId for the purchase record
                        } else {
                            // No batch with this price exists: Create a NEW batch row
                            pId = await DB.products.add({
                                barcode: item.barcode,
                                name: item.name,
                                category: item.category,
                                type: item.type,
                                price: item.sellingPrice,
                                buyingPrice: item.buyingPrice,
                                stock: item.quantity,
                                minStock: item.minStock
                            });
                        }
                    }
                }
            }
            
            // Prepare Item for Purchase Record
            finalItems.push({
                productId: pId,
                barcode: item.barcode,
                name: item.name,
                quantity: item.quantity,
                type: item.type,
                buyingPrice: item.buyingPrice,
                sellingPrice: item.sellingPrice,
                total: item.total
            });

            if (expDate) {
                await DB.stock_batches.add({
                    productId: pId,
                    barcode: item.barcode,
                    expDate,
                    createdAt: new Date(date || new Date())
                });
            }
        }
        
        // 2. Save Purchase Record
        const purchaseId = await DB.purchases.add({
            supplier: supplier || 'Unknown',
            date,
            totalCost,
            items: finalItems
        });

        const supplierRef = await DB.suppliers.getOrCreateByCode(supplierCode, supplier || 'Unknown');
        await DB.supplier_ledger.add({
            supplierId: supplierRef.id,
            purchaseId,
            date,
            type: 'purchase',
            amount: totalCost,
            ref: 'purchase'
        });
        
        alert('Stock received successfully!');
        closeReceiveStockModal();
        await loadProducts();
        await loadCategories();
        await refreshLedgerSummaryCards();
        await loadUnpaidPurchases();
        displayInventory();
        
    } catch (error) {
        console.error('Purchase error:', error);
        alert('Error saving purchase.');
    }
}

// View sale details
async function viewSaleDetails(saleId) {
    const sale = await DB.sales.getById(saleId);
    if (!sale) return;
    
    showReceipt(saleId, sale);
}

// Settings Functions
async function loadLedgerTables() {
    const [customerEntries, supplierEntries, customersAll, suppliersAll] = await Promise.all([
        DB.customer_ledger.getAll(),
        DB.supplier_ledger.getAll(),
        DB.customers.getAll(),
        DB.suppliers.getAll()
    ]);

    const customerNameById = new Map(customersAll.map(c => [Number(c.id), c.name || `Customer #${c.id}`]));
    const supplierNameById = new Map(suppliersAll.map(s => [Number(s.id), s.name || `Supplier #${s.id}`]));

    const customerBody = document.getElementById('settings-customer-ledger-body');
    const supplierBody = document.getElementById('settings-supplier-ledger-body');

    if (customerBody) {
        const sorted = [...customerEntries].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 100);
        if (sorted.length === 0) {
            customerBody.innerHTML = '<tr><td colspan="4" class="px-3 py-4 text-center text-gray-400">No customer ledger entries</td></tr>';
        } else {
            customerBody.innerHTML = sorted.map((entry) => {
                const impact = customerLedgerImpact(entry);
                const impactClass = impact >= 0 ? 'text-amber-700' : 'text-emerald-700';
                return `
                    <tr>
                        <td class="px-3 py-2">${formatDateForDisplay(entry.date)}</td>
                        <td class="px-3 py-2">${customerNameById.get(Number(entry.customerId)) || '-'}</td>
                        <td class="px-3 py-2">${entry.type || ''}</td>
                        <td class="px-3 py-2 text-right font-bold ${impactClass}">${impact >= 0 ? '+' : ''}${impact.toFixed(2)}</td>
                    </tr>
                `;
            }).join('');
        }
    }

    if (supplierBody) {
        const sorted = [...supplierEntries].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 100);
        if (sorted.length === 0) {
            supplierBody.innerHTML = '<tr><td colspan="4" class="px-3 py-4 text-center text-gray-400">No supplier ledger entries</td></tr>';
        } else {
            supplierBody.innerHTML = sorted.map((entry) => {
                const impact = supplierLedgerImpact(entry);
                const impactClass = impact >= 0 ? 'text-rose-700' : 'text-emerald-700';
                return `
                    <tr>
                        <td class="px-3 py-2">${formatDateForDisplay(entry.date)}</td>
                        <td class="px-3 py-2">${supplierNameById.get(Number(entry.supplierId)) || '-'}</td>
                        <td class="px-3 py-2">${entry.type || ''}</td>
                        <td class="px-3 py-2 text-right font-bold ${impactClass}">${impact >= 0 ? '+' : ''}${impact.toFixed(2)}</td>
                    </tr>
                `;
            }).join('');
        }
    }
}

async function recordCustomerPayment(event) {
    event.preventDefault();
    if (!requirePermission('settings:write', 'Only owner/manager can record customer payments.')) return;

    const date = document.getElementById('customer-payment-date')?.value;
    const selectedCustomerId = Number(document.getElementById('customer-payment-customer-id')?.value || 0);
    const name = document.getElementById('customer-payment-name')?.value?.trim();
    const amount = Number(document.getElementById('customer-payment-amount')?.value || 0);
    const note = document.getElementById('customer-payment-note')?.value?.trim() || '';

    if (!date || amount <= 0 || (!selectedCustomerId && !name)) {
        alert('Please enter valid customer payment details');
        return;
    }

    let customer = null;
    if (selectedCustomerId) {
        const customers = await DB.customers.getAll();
        customer = customers.find((c) => Number(c.id) === selectedCustomerId) || null;
    } else {
        customer = await DB.customers.getOrCreateByName(name);
    }

    if (!customer) {
        alert('Unable to find/create customer');
        return;
    }

    await DB.customer_ledger.add({
        customerId: customer.id,
        date: new Date(`${date}T12:00:00`),
        type: 'payment',
        amount,
        ref: 'customer-payment',
        note
    });

    document.getElementById('customer-payment-amount').value = '';
    document.getElementById('customer-payment-note').value = '';
    await loadPaymentFormOptions();
    await loadLedgerTables();
    await loadUnpaidPurchases();
    await loadCustomerPaymentStatus();
    await loadSupplierPaymentStatus();
    await refreshLedgerSummaryCards();
    if (currentPage === 'reports') await generateReport();
    alert('Customer payment recorded');
}

async function recordSupplierPayment(event) {
    event.preventDefault();
    if (!requirePermission('settings:write', 'Only owner/manager can record supplier payments.')) return;

    const date = document.getElementById('supplier-payment-date')?.value;
    const selectedSupplierId = Number(document.getElementById('supplier-payment-supplier-id')?.value || 0);
    const selectedPurchaseId = Number(document.getElementById('supplier-payment-purchase-id')?.value || 0);
    const targetedPurchaseId = selectedSupplierId ? selectedPurchaseId : 0;
    const name = document.getElementById('supplier-payment-name')?.value?.trim();
    const amount = Number(document.getElementById('supplier-payment-amount')?.value || 0);
    const note = document.getElementById('supplier-payment-note')?.value?.trim() || '';

    if (!date || amount <= 0 || (!selectedSupplierId && !name)) {
        alert('Please enter valid supplier payment details');
        return;
    }

    let supplier = null;
    if (selectedSupplierId) {
        const suppliers = await DB.suppliers.getAll();
        supplier = suppliers.find((s) => Number(s.id) === selectedSupplierId) || null;
    } else {
        supplier = await DB.suppliers.getOrCreateByName(name);
    }

    if (!supplier) {
        alert('Unable to find/create supplier');
        return;
    }

    const paymentDate = new Date(`${date}T12:00:00`);
    let remaining = amount;
    let allocated = 0;

    if (targetedPurchaseId) {
        const status = await DB.getPurchasePaymentStatus(targetedPurchaseId);
        if (!status) {
            alert('Selected purchase not found');
            return;
        }
        const applyAmount = Math.min(remaining, status.outstanding);
        if (applyAmount <= 0) {
            alert('Selected purchase is already fully paid');
            return;
        }
        await DB.supplier_ledger.add({
            supplierId: supplier.id,
            purchaseId: targetedPurchaseId,
            date: paymentDate,
            type: 'payment',
            amount: applyAmount,
            ref: 'supplier-payment',
            note
        });
        remaining -= applyAmount;
        allocated += applyAmount;
    } else {
        const allPurchases = await DB.purchases.getAll();
        const supplierPurchases = allPurchases
            .filter((p) => ((p.supplier || '').trim().toLowerCase() === (supplier.name || '').trim().toLowerCase()))
            .sort((a, b) => new Date(a.date) - new Date(b.date));

        for (const purchase of supplierPurchases) {
            if (remaining <= 0) break;
            const status = await DB.getPurchasePaymentStatus(purchase.id);
            if (!status || status.outstanding <= 0) continue;
            const applyAmount = Math.min(remaining, status.outstanding);
            await DB.supplier_ledger.add({
                supplierId: supplier.id,
                purchaseId: purchase.id,
                date: paymentDate,
                type: 'payment',
                amount: applyAmount,
                ref: 'supplier-payment',
                note: note || `Auto allocated to purchase #${purchase.id}`
            });
            remaining -= applyAmount;
            allocated += applyAmount;
        }
    }

    if (remaining > 0) {
        await DB.supplier_ledger.add({
            supplierId: supplier.id,
            date: paymentDate,
            type: 'payment',
            amount: remaining,
            ref: 'supplier-payment-advance',
            note: note || 'Advance payment'
        });
    }

    document.getElementById('supplier-payment-amount').value = '';
    document.getElementById('supplier-payment-note').value = '';
    await loadPaymentFormOptions();
    await loadLedgerTables();
    await loadUnpaidPurchases();
    await loadCustomerPaymentStatus();
    await loadSupplierPaymentStatus();
    await refreshLedgerSummaryCards();
    if (currentPage === 'reports') await generateReport();
    const advance = remaining > 0 ? `, advance Rs. ${remaining.toFixed(2)}` : '';
    alert(`Supplier payment recorded. Allocated Rs. ${allocated.toFixed(2)}${advance}`);
}

async function exportCustomerLedgerCSV() {
    const fromDate = document.getElementById('report-from-date')?.value || '';
    const toDate = document.getElementById('report-to-date')?.value || '';
    const [entries, customersAll] = await Promise.all([DB.customer_ledger.getAll(), DB.customers.getAll()]);
    const customerNameById = new Map(customersAll.map(c => [Number(c.id), c.name || `Customer #${c.id}`]));
    const filtered = entries.filter((e) => {
        const key = dateKeyOf(e.date);
        if (!fromDate || !toDate) return true;
        return key >= fromDate && key <= toDate;
    });

    let csv = 'Date,Customer,Type,Ref,Note,Amount,Impact\n';
    filtered.sort((a, b) => new Date(a.date) - new Date(b.date)).forEach((e) => {
        const impact = customerLedgerImpact(e);
        const row = [
            formatDateForDisplay(e.date),
            customerNameById.get(Number(e.customerId)) || '',
            e.type || '',
            e.ref || '',
            e.note || '',
            Number(e.amount || 0).toFixed(2),
            impact.toFixed(2)
        ].map(v => `"${String(v).replaceAll('"', '""')}"`).join(',');
        csv += `${row}\n`;
    });

    downloadCSV(csv, `Customer_Ledger_${fromDate || 'all'}_to_${toDate || 'all'}.csv`);
}

async function exportSupplierLedgerCSV() {
    const fromDate = document.getElementById('report-from-date')?.value || '';
    const toDate = document.getElementById('report-to-date')?.value || '';
    const [entries, suppliersAll] = await Promise.all([DB.supplier_ledger.getAll(), DB.suppliers.getAll()]);
    const supplierNameById = new Map(suppliersAll.map(s => [Number(s.id), s.name || `Supplier #${s.id}`]));
    const filtered = entries.filter((e) => {
        const key = dateKeyOf(e.date);
        if (!fromDate || !toDate) return true;
        return key >= fromDate && key <= toDate;
    });

    let csv = 'Date,Supplier,Type,Ref,Note,Amount,Impact\n';
    filtered.sort((a, b) => new Date(a.date) - new Date(b.date)).forEach((e) => {
        const impact = supplierLedgerImpact(e);
        const row = [
            formatDateForDisplay(e.date),
            supplierNameById.get(Number(e.supplierId)) || '',
            e.type || '',
            e.ref || '',
            e.note || '',
            Number(e.amount || 0).toFixed(2),
            impact.toFixed(2)
        ].map(v => `"${String(v).replaceAll('"', '""')}"`).join(',');
        csv += `${row}\n`;
    });

    downloadCSV(csv, `Supplier_Ledger_${fromDate || 'all'}_to_${toDate || 'all'}.csv`);
}

async function loadShopSettings() {
    try {
        const settings = await DB.shop_settings.get();
        if (settings) {
            document.getElementById('shop-name').value = settings.name || '';
            document.getElementById('shop-phone').value = settings.phone || '';
            document.getElementById('shop-address').value = settings.address || '';
            document.getElementById('shop-info').value = settings.info || '';
        }
    } catch (error) {
        console.error('Error loading shop settings:', error);
    }
}

async function saveShopSettings(event) {
    event.preventDefault();
    if (!requirePermission('settings:write', 'Only owner/manager can update settings.')) return;
    
    const settings = {
        name: document.getElementById('shop-name').value,
        phone: document.getElementById('shop-phone').value,
        address: document.getElementById('shop-address').value,
        info: document.getElementById('shop-info').value
    };
    
    try {
        await DB.shop_settings.save(settings);
        alert('Shop settings saved successfully! These details will appear on your bills.');
    } catch (error) {
        console.error('Error saving shop settings:', error);
        alert('Error saving settings. Please try again.');
    }
}

async function exportData() {
    if (!requirePermission('data:export', 'Only owner/manager can export backup data.')) return;
    try {
        const data = await DB.exportAll();
        const summary = summarizeBackupData(data);
        const dataStr = JSON.stringify(data, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        const stamp = new Date().toISOString().replace(/[:]/g, '-').split('.')[0];
        link.download = `sillara-pos-backup-${stamp}.json`;
        link.click();
        
        URL.revokeObjectURL(url);
        
        alert(`Data exported successfully!\n${formatBackupSummary(summary)}\n\nFile saved via your browser download location.`);
    } catch (error) {
        console.error('Export error:', error);
        alert('Error exporting data. Please try again.');
    }
}

async function importData(input) {
    const file = input.files[0];
    if (!file) return;

    if (!requirePermission('settings:write', 'Only owner/manager can import data.')) {
        input.value = '';
        return;
    }
    
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        validateBackupPayload(data);

        const summary = summarizeBackupData(data);
        const summaryText = formatBackupSummary(summary);
        const checksumState = data.checksum ? 'Checksum present' : 'Checksum not present (legacy backup)';
        const versionText = data.version ? `Backup version: ${data.version}` : 'Backup version: unknown';
        
        if (!confirm(`Backup Preview\n${summaryText}\n${versionText}\n${checksumState}\n\nThis will replace all existing data. Continue?`)) {
            input.value = '';
            return;
        }
        
        try {
            await DB.importAll(data);
        } catch (importError) {
            const message = String(importError?.message || importError || '');
            const isChecksumError = message.toLowerCase().includes('checksum validation failed');
            if (!isChecksumError) throw importError;

            const force = confirm(
                'Checksum validation failed.\n\nIf this file is from your own Export All Data, you can continue with Force Import.\nContinue with Force Import?'
            );
            if (!force) {
                throw importError;
            }

            // Force import for trusted legacy/cross-version backup files.
            const { checksum, ...payloadWithoutChecksum } = data;
            await DB.importAll(payloadWithoutChecksum);
        }
        await loadProducts();
        await loadCategories();
        await updateDashboard();
        await refreshLedgerSummaryCards();
        await loadLedgerTables();
        await loadDayClosingRows();
        await updateDayClosePreview();
        if (currentPage === 'expenses') await loadExpensesTable();
        if (currentPage === 'reports') await generateReport();
        
        alert('Data imported successfully!');
        
        // Reload current page
        showPage(currentPage);
    } catch (error) {
        console.error('Import error:', error);
        alert(`Error importing data: ${error?.message || 'Please check the file format.'}`);
    }
    
    input.value = '';
}

async function confirmClearData() {
    if (!requirePermission('settings:write', 'Only owner/manager can clear all data.')) return;
    if (!confirm('⚠️ WARNING: This will delete ALL data permanently! Are you sure?')) {
        return;
    }
    
    if (!confirm('This action cannot be undone. Click OK to proceed.')) {
        return;
    }
    
    try {
        await DB.clearAll();
        await loadProducts();
        await updateDashboard();
        
        alert('All data cleared successfully!');
        showPage('dashboard');
    } catch (error) {
        console.error('Clear data error:', error);
        alert('Error clearing data. Please try again.');
    }
}

async function loadSampleData() {
    if (!requirePermission('settings:write', 'Only owner/manager can load sample data.')) return;
    if (!confirm('Load sample products and sales data?')) {
        return;
    }
    
    try {
        await DB.loadSampleData();
        await loadProducts();
        await updateDashboard();
        
        alert('Sample data loaded successfully!');
        
        // Refresh current page
        showPage(currentPage);
    } catch (error) {
        console.error('Load sample data error:', error);
        alert('Error loading sample data. Please try again.');
    }
}

function parseDateOnly(dateInput) {
    const d = new Date(dateInput);
    d.setHours(0, 0, 0, 0);
    return d;
}

async function calculateExpectedDrawerForDate(dateKey, openingCash = 0) {
    const [sales, expenses, returns, customerEntries, supplierEntries] = await Promise.all([
        DB.sales.getAll(),
        DB.expenses.getAll(),
        DB.returns.getAll(),
        DB.customer_ledger.getAll(),
        DB.supplier_ledger.getAll()
    ]);

    const inDay = (value) => dateKeyOf(value) === dateKey;

    const creditBySaleRef = new Map();
    customerEntries
        .filter((e) => e.type === 'sale' && inDay(e.date) && String(e.ref || '').startsWith('sale:'))
        .forEach((e) => {
            const ref = String(e.ref || '');
            creditBySaleRef.set(ref, (creditBySaleRef.get(ref) || 0) + (Number(e.amount) || 0));
        });

    const cashFromSales = sales
        .filter((s) => inDay(s.date))
        .reduce((sum, s) => {
            const total = Number(s.totalAmount) || 0;
            const due = creditBySaleRef.get(`sale:${s.id}`) || 0;
            const received = Math.max(0, total - Math.max(0, due));
            return sum + received;
        }, 0);

    const customerPaymentIn = customerEntries
        .filter((e) => e.type === 'payment' && inDay(e.date))
        .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    const supplierPaymentOut = supplierEntries
        .filter((e) => e.type === 'payment' && inDay(e.date))
        .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    const dayExpenses = expenses
        .filter((e) => inDay(e.date))
        .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    const dayCustomerReturnAmount = returns
        .filter((r) => r.type === 'customer' && inDay(r.date))
        .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

    return Number(openingCash || 0) + cashFromSales + customerPaymentIn - supplierPaymentOut - dayExpenses - dayCustomerReturnAmount;
}

function getDayCloseStatus(variance) {
    if (Math.abs(variance) < 0.01) return 'matched';
    return variance < 0 ? 'shortage' : 'excess';
}

function applyDayCloseStatusPreview(status, variance) {
    const varianceEl = document.getElementById('day-close-variance');
    const badge = document.getElementById('day-close-status-badge');
    if (varianceEl) {
        varianceEl.textContent = variance.toFixed(2);
        varianceEl.className = `text-xl font-bold ${status === 'shortage' ? 'text-red-600' : (status === 'excess' ? 'text-amber-600' : 'text-emerald-600')}`;
    }
    if (badge) {
        if (status === 'shortage') {
            badge.className = 'inline-flex items-center px-2 py-1 text-xs rounded-full bg-red-100 text-red-700 font-bold';
            badge.textContent = 'Shortage';
        } else if (status === 'excess') {
            badge.className = 'inline-flex items-center px-2 py-1 text-xs rounded-full bg-amber-100 text-amber-700 font-bold';
            badge.textContent = 'Excess';
        } else {
            badge.className = 'inline-flex items-center px-2 py-1 text-xs rounded-full bg-emerald-100 text-emerald-700 font-bold';
            badge.textContent = 'Matched';
        }
    }
}

async function updateDayClosePreview() {
    const token = ++dayClosePreviewToken;
    const dateKey = document.getElementById('day-close-date')?.value || '';
    const openingCash = Number(document.getElementById('day-close-opening')?.value || 0);
    const actualCash = Number(document.getElementById('day-close-actual')?.value || 0);
    const expectedEl = document.getElementById('day-close-expected');

    if (!dateKey || Number.isNaN(openingCash)) {
        if (expectedEl) expectedEl.value = '0.00';
        applyDayCloseStatusPreview('matched', 0);
        return;
    }

    const expectedCash = await calculateExpectedDrawerForDate(dateKey, openingCash);
    if (token !== dayClosePreviewToken) return;

    if (expectedEl) expectedEl.value = expectedCash.toFixed(2);
    const variance = (Number.isNaN(actualCash) ? 0 : actualCash) - expectedCash;
    applyDayCloseStatusPreview(getDayCloseStatus(variance), variance);
}

function calculateDayCloseDenominations() {
    let total = 0;
    DAY_CLOSE_DENOMINATIONS.forEach((denom) => {
        const qty = Math.max(0, Math.floor(Number(document.getElementById(`day-denom-${denom}`)?.value || 0)));
        total += denom * qty;
    });

    const totalEl = document.getElementById('day-close-denom-total');
    if (totalEl) totalEl.textContent = total.toFixed(2);

    const actualEl = document.getElementById('day-close-actual');
    if (actualEl) actualEl.value = total.toFixed(2);
    updateDayClosePreview();
}

async function requestOwnerShortageApproval() {
    if (currentUser?.role === 'owner') return currentUser.username;

    const username = prompt('Shortage approval required. Enter owner username:');
    if (!username) return null;
    const password = prompt('Enter owner password for approval:');
    if (!password) return null;

    const ownerUser = await DB.users.verify(username.trim(), password);
    if (!ownerUser || ownerUser.role !== 'owner') {
        alert('Owner approval failed. Shortage close cancelled.');
        return null;
    }
    return ownerUser.username;
}

async function closeDay(event) {
    event.preventDefault();
    if (!requirePermission('dayclose:write', 'Only owner/manager can close the day.')) return;

    const dateKey = document.getElementById('day-close-date')?.value;
    const openingCash = Number(document.getElementById('day-close-opening')?.value || 0);
    const actualCash = Number(document.getElementById('day-close-actual')?.value || 0);
    const notes = document.getElementById('day-close-notes')?.value?.trim() || '';

    if (!dateKey) {
        alert('Please select day close date');
        return;
    }
    if (Number.isNaN(openingCash) || Number.isNaN(actualCash) || openingCash < 0 || actualCash < 0) {
        alert('Please enter valid opening/actual cash values');
        return;
    }

    const existing = await DB.day_closings.getByDate(dateKey);
    if (existing) {
        alert('This date is already closed.');
        return;
    }

    const expectedCash = await calculateExpectedDrawerForDate(dateKey, openingCash);
    const variance = actualCash - expectedCash;
    const status = getDayCloseStatus(variance);
    const isShortage = status === 'shortage';

    let approvedBy = '';
    let shortageExpenseId = null;
    let varianceExpenseId = null;

    if (isShortage) {
        if (!confirm(`Cash shortage detected: Rs. ${Math.abs(variance).toFixed(2)}. Do you want to close the day?`)) {
            return;
        }

        const requireAdmin = !!document.getElementById('day-close-require-admin')?.checked;
        if (requireAdmin) {
            approvedBy = await requestOwnerShortageApproval();
            if (!approvedBy) return;
        } else {
            approvedBy = currentUser?.username || '';
        }

        shortageExpenseId = await DB.expenses.add({
            date: new Date(`${dateKey}T23:59:00`),
            category: 'Cash Shortage',
            description: `Day close shortage on ${dateKey}`,
            amount: Math.abs(variance)
        });
        varianceExpenseId = shortageExpenseId;
    }

    if (status === 'excess') {
        const confirmExcess = confirm(`Cash excess detected: Rs. ${Math.abs(variance).toFixed(2)}. Record as cash excess adjustment and close day?`);
        if (!confirmExcess) return;
        varianceExpenseId = await DB.expenses.add({
            date: new Date(`${dateKey}T23:59:00`),
            category: 'Cash Excess',
            description: `Day close excess on ${dateKey}`,
            amount: -Math.abs(variance)
        });
    }

    await DB.day_closings.add({
        date: dateKey,
        openingCash,
        expectedCash,
        actualCash,
        variance,
        status,
        approvedBy,
        shortageExpenseId,
        varianceExpenseId,
        notes,
        closedBy: currentUser?.username || 'unknown'
    });

    alert('Day closed successfully.');
    document.getElementById('day-close-notes').value = '';
    await updateDayClosePreview();
    await loadDayClosingRows();
    if (currentPage === 'expenses') await loadExpensesTable();
    if (currentPage === 'reports') await generateReport();
}

async function loadDayClosingRows() {
    const body = document.getElementById('day-close-list-body');
    if (!body) return;

    const rows = await DB.day_closings.getAll();
    rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));

    if (rows.length === 0) {
        body.innerHTML = '<tr><td colspan="8" class="px-2 py-2 text-gray-400 text-center">No day closing records yet.</td></tr>';
        return;
    }

    body.innerHTML = rows.map(r => {
        const variance = Number(r.variance) || 0;
        const varianceClass = variance < 0 ? 'text-red-600' : (variance > 0 ? 'text-amber-600' : 'text-emerald-600');
        const status = String(r.status || getDayCloseStatus(variance));
        const statusBadge = status === 'shortage'
            ? '<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700">Shortage</span>'
            : (status === 'excess'
                ? '<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-700">Excess</span>'
                : '<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">Matched</span>');
        return `
            <tr>
                <td class="px-2 py-2">${r.date || ''}</td>
                <td class="px-2 py-2 text-right">${Number(r.openingCash || 0).toFixed(2)}</td>
                <td class="px-2 py-2 text-right">${Number(r.expectedCash || 0).toFixed(2)}</td>
                <td class="px-2 py-2 text-right">${Number(r.actualCash || 0).toFixed(2)}</td>
                <td class="px-2 py-2 text-right ${varianceClass}">${variance.toFixed(2)}</td>
                <td class="px-2 py-2">${statusBadge}</td>
                <td class="px-2 py-2">${r.approvedBy || '-'}</td>
                <td class="px-2 py-2">${r.notes || ''}</td>
            </tr>
        `;
    }).join('');
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + N for new bill (POS page)
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        showPage('pos');
    }
    
    // Escape to close modals
    if (e.key === 'Escape') {
        closeProductModal();
        closeQuantityModal();
        closeReceiptModal();
        closeReceiveStockModal();
    }
});

console.log('Sillara-POS App Ready! 🛒');
