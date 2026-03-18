# Sillara-POS - සිල්ලර බඩු කඩය

A modern, lightweight, browser-based Point of Sale (POS) system designed for single-location retail stores in Sri Lanka. Built with vanilla HTML, CSS, JavaScript, Tailwind CSS, and Dexie.js for offline-first functionality.

## 🌟 Features

### 📊 Dashboard

- Real-time sales statistics
- Today's sales total and transaction count
- Low stock alerts with visual indicators
- Quick access to all major functions
- Beautiful gradient cards with hover effects

### 🛒 Point of Sale (POS)

- Fast product search functionality
- Category-based filtering (Grocery, Vegetables, Biscuits, Household)
- Support for both unit-based and weight-based products
- Real-time cart management
- Automatic stock deduction
- Printable receipts (thermal printer compatible)
- Bilingual support (English & Sinhala)

### 📦 Inventory Management

- Add/Edit/Delete products
- Support for multiple product categories
- Weight-based items (Rice, Sugar, Vegetables)
- Unit-based items (Biscuits, Soap, Household items)
- Low stock alerts with customizable thresholds
- Real-time stock updates

### 📈 Sales Reports

- Date range filtering
- Total sales and transaction summary
- Average bill calculation
- Detailed sales history
- View individual bill receipts
- Item-wise sales analysis

### ⚙️ Settings & Data Management

- Export all data as JSON backup
- Import data from backup files
- Load sample data for testing
- Clear database option
- All data stored locally in browser

## 🚀 Technology Stack

- **HTML5** - Semantic markup
- **Tailwind CSS** (CDN) - Modern, responsive styling
- **JavaScript ES6+** - Vanilla JavaScript, no frameworks
- **Dexie.js** (CDN) - IndexedDB wrapper for local storage
- **Remix Icons** (CDN) - Beautiful icon library
- **Google Fonts** - Inter & Noto Sans Sinhala

## 📦 Installation

No installation required! This is a pure HTML/CSS/JS application.

### Option 1: Direct File Opening

1. Simply open `index.html` in any modern web browser
2. The app will work immediately with all features

### Option 2: Local Web Server (Recommended)

For the best experience, use a local web server:

**Using Python:**

```bash
# Python 3
python -m http.server 8000

# Then open: http://localhost:8000
```

**Using Node.js (http-server):**

```bash
npx http-server -p 8000

# Then open: http://localhost:8000
```

**Using VS Code:**

- Install "Live Server" extension
- Right-click on `index.html` → "Open with Live Server"

## 🎯 Quick Start Guide

### First Time Setup

1. **Load Sample Data:**
   - Go to Settings page
   - Click "Load Sample Data"
   - This will populate the database with example products and sales

2. **Start Selling:**
   - Go to POS page
   - Search or browse products
   - Click on a product to add to cart
   - Enter quantity/weight
   - Click "Complete Sale" to process

### Adding Your Own Products

1. Go to **Inventory** page
2. Click **"Add New Product"**
3. Fill in the details:
   - Product Name (supports Sinhala)
   - Category (Grocery, Vegetables, Biscuits, Household, Other)
   - Type (Unit or Weight)
   - Selling Price
   - Current Stock
   - Low Stock Alert threshold

### Making a Sale

1. Go to **POS** page
2. Search for products or filter by category
3. Click on a product
4. Enter quantity (for units) or weight (for kg)
5. Review cart
6. Click **"Complete Sale"**
7. Print receipt or close

### Viewing Reports

1. Go to **Reports** page
2. Select date range
3. Click **"Generate Report"**
4. View sales summary and detailed transactions
5. Click "View" on any sale to see the full receipt

## 💾 Data Management

### Backup Your Data

1. Go to **Settings** page
2. Click **"Export All Data"**
3. Save the JSON file in a safe location

### Restore Data

1. Go to **Settings** page
2. Click **"Import Data"**
3. Select your backup JSON file

### Clear Data

1. Go to **Settings** page
2. Click **"Clear All Data"**
3. Confirm the action (⚠️ This cannot be undone!)

## 📱 Browser Compatibility

- ✅ Chrome 80+
- ✅ Firefox 75+
- ✅ Safari 13+
- ✅ Edge 80+
- ✅ Mobile browsers (iOS Safari, Chrome Mobile)

## 🎨 Key Features

### Offline-First Architecture

- All data stored in IndexedDB
- Works 100% without internet
- No server costs
- No backend required

### Responsive Design

- Mobile-first approach
- Works on phones, tablets, and desktops
- Touch-friendly interface
- Print-optimized receipts

### Bilingual Support

- English and Sinhala labels
- Unicode support for Sinhala text
- Cultural customization for Sri Lankan stores

### Performance

- Instant search (< 200ms)
- Handles 500+ products smoothly
- Smooth animations
- Optimized for low-end devices

## 🔧 Customization

### Changing Colors

Edit the `tailwind.config` in `index.html`:

```javascript
tailwind.config = {
  theme: {
    extend: {
      colors: {
        primary: {
          /* Your primary color palette */
        },
        accent: {
          /* Your accent color palette */
        },
      },
    },
  },
};
```

### Adding New Categories

Edit the category options in:

1. Product form modal in `index.html`
2. Category filter buttons in `index.html`

### Modifying Low Stock Threshold

Default is 5 units. Change in:

- `db.js` → `loadSampleData()` function
- Product form default value

## 📊 Database Schema

### Products Table

```javascript
{
    id: number,           // Auto-increment
    name: string,         // Product name
    category: string,     // Category name
    type: string,         // 'unit' or 'weight'
    price: number,        // Selling price
    stock: number,        // Current stock
    minStock: number      // Low stock threshold
}
```

### Sales Table

```javascript
{
    id: number,           // Auto-increment
    date: Date,          // Sale date/time
    totalAmount: number, // Total bill amount
    items: Array         // Array of sold items
}
```

## 🐛 Troubleshooting

### Data not persisting?

- Ensure you're not in "Private/Incognito" mode
- Check browser IndexedDB is enabled
- Export data regularly as backup

### Search not working?

- Ensure products exist in database
- Try loading sample data first
- Check browser console for errors

### Print not working?

- Allow pop-ups in browser
- Check printer settings
- Use "Print" button in receipt modal

## 📄 License

This project is open source and available for personal and commercial use.

## 🤝 Support

For issues or questions:

1. Check the browser console for error messages
2. Export your data before making changes
3. Try loading the page in a different browser

## 🎉 Credits

Built with:

- [Tailwind CSS](https://tailwindcss.com/)
- [Dexie.js](https://dexie.org/)
- [Remix Icons](https://remixicon.com/)
- [Google Fonts](https://fonts.google.com/)

---

Made with ❤️ for Sri Lankan small businesses

සිල්ලර බඩු කඩේ අයට විශේෂයෙන්ම! 🇱🇰
