# Project Name Sillara-POS - Single Store Retail Management System

## 1. Executive Summary
A lightweight, browser-based Point of Sale (POS) system designed for a single-location retail store (Sillara Badu Kadaya). The system replaces manual bookkeeping with a digital solution to manage sales, inventory, and billing. It runs entirely in the browser using Dexie.js for local database management, ensuring zero server costs and offline functionality.

---

## 2. Business Requirements (BRD)

### 2.1. Store Overview & Product Types
The system must support a diverse range of products typical to a Sri Lankan grocery store
 Weighable Items (Loose) Rice (Hal), Sugar (Sini), Dhal, Potatoes, Onions.
     Requirement Price calculated per gramkg.
 Daily Market Items Vegetables (Elawalu).
     Requirement Prices fluctuate daily; easy update mechanism needed.
 Packaged Goods (FMCG) Biscuits (Maliban, Munchee), Soap (Baby soap, Sunlight).
     Requirement Fixed prices, stock managed by unit (packetsbars).
 General Household Basins (Besam), Brooms, Utensils.
     Requirement Non-perishable, unit-based tracking.

### 2.2. Core Features

#### A. Dashboard (Home)
 View total sales for the current day.
 Quick shortcut to New Bill.
 Low stock alerts (e.g., if Sugar is below 5kg).

#### B. Inventory Management (Stock)
 Add Item Name, Category (VegGroceryHousehold), Cost Price, Selling Price, Unit (kggpacketpiece).
 Stock Update Ability to add new stock when suppliers (e.g., Maliban Rep) visit.
 Price Adjustment Quick edit feature for vegetable prices every morning.

#### C. Billing & Point of Sale (POS)
 Search Quick search bar to find items by name (e.g., type Sun - shows Sunlight).
 Cart Add items to a bill.
     For RiceSugar Input weight (e.g., 500g).
     For SoapBiscuits Input quantity (e.g., 2 packets).
 Total Calculation Automatic sum of the bill.
 Checkout Print Bill or Complete Sale button.
 Receipt A simple, printable view (HTMLCSS) for thermal printers or A5 paper.

#### D. Reporting (Basic)
 Daily Sales Report How much cash was collected today
 Item Wise Sales Which biscuit brand sold more today (Maliban vs Munchee).

---

## 3. Technical Requirements (TRD)

### 3.1. Technology Stack
 Frontend Structure `HTML5` (Semantic markup).
 Styling `Tailwind CSS` (Via CDN for ease of development without complex build tools, or standard CLI if preferred).
 Logic `JavaScript` (Vanilla ES6+).
 Database `Dexie.js` (Wrapper for IndexedDB).
     Why Allows storing huge amounts of data inside the browser reliably. No backend server (SQLPHP) needed.
 Icons `RemixIcon` or `FontAwesome` (CDN).

### 3.2. Data Architecture (Dexie.js Schema)
The database named `SillaraDB` will have the following tables (stores)

1.  products
     `id` (Auto-increment)
     `name` (String) - e.g., Munchee Super Cream
     `category` (String) - e.g., Biscuits
     `type` (String) - unit or weight
     `price` (Number) - Selling price
     `stock` (Number) - Current quantity
2.  sales
     `id` (Auto-increment)
     `date` (Date object)
     `totalAmount` (Number)
     `items` (Array of Objects) - Snapshot of items sold in this bill.

### 3.3. UIUX Design Guidelines (Tailwind)
 Mobile-First The POS should work on a phone or tablet if the laptop is busy.
 Color Coding
     Green buttons for Add to Cart  Complete Sale.
     Red buttons for Delete Item  Cancel.
     Large fonts for Prices and Totals (easy visibility).

### 3.4. Non-Functional Requirements
 Offline First The system works 100% without internet.
 Data Backup A Export Data button to download all salesstock as a `.json` file (Critical since data lives in the browser).
 Performance Search must be instant (under 200ms) even with 500+ items.

---

## 4. Implementation Steps (Roadmap)

1.  Step 1 Create `index.html` and link Tailwind CSS (CDN) & Dexie.js (CDN).
2.  Step 2 Initialize Dexie DB in `db.js` and create the schema.
3.  Step 3 Build the Inventory Page (Forms to add Rice, Soap, Veg, etc.).
4.  Step 4 Build the POS Interface (Grid of items + Bill section on the right).
5.  Step 5 Implement the logic to deduct stock when a sale is made.
6.  Step 6 Design the Print Layout (hide buttons, show only list & total).