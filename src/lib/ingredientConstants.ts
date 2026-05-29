// Shared ingredient constants — used in LibraryModule, IngredientLibrary, RecipeView
export const ING_CATEGORIES = [
  'Bar', 'Coffee & Beverage', 'Dairy & Eggs', 'Fruits',
  'Herbs & Spices', 'Oils & Vinegars', 'Pantry', 'Pasta & Grains',
  'Proteins', 'Stocks & Sauces', 'Vegetables',
]

export const SUBCATEGORIES: Record<string, string[]> = {
  'Proteins':        ['Beef', 'Pork', 'Poultry', 'Fish', 'Shellfish', 'Plant-Based'],
  'Herbs & Spices':  ['Salt', 'Spices', 'Dried Herbs'],
  'Dairy & Eggs':    ['Butter', 'Cheese', 'Eggs', 'Cream', 'Milk'],
  'Oils & Vinegars': ['Oils', 'Vinegars'],
  'Pantry':          ['Preserved', 'Nuts & Seeds', 'Sugars'],
  'Vegetables':      ['Nightshades', 'Mushrooms', 'Root Veg', 'Leafy Greens', 'Alliums'],
  'Fruits':          ['Citrus', 'Stone Fruit', 'Berries'],
  'Bar':             ['Spirits', 'Vermouths', 'Liqueurs', 'Bitters', 'Syrups', 'Juices'],
  'Pasta & Grains':  ['Pasta', 'Rice', 'Flours'],
  'Stocks & Sauces': ['Stocks', 'Sauces', 'Pastes'],
}

export const ALLERGENS = [
  'Gluten', 'Dairy', 'Nuts', 'Peanuts', 'Shellfish',
  'Eggs', 'Soy', 'Sesame', 'Fish', 'Other',
]

export const CAT_ICONS: Record<string, string> = {
  'Bar': '🍸', 'Coffee & Beverage': '☕', 'Dairy & Eggs': '🧀',
  'Fruits': '🍋', 'Herbs & Spices': '🌿', 'Oils & Vinegars': '🫙',
  'Pantry': '🥫', 'Pasta & Grains': '🍝', 'Proteins': '🥩',
  'Stocks & Sauces': '🫕', 'Vegetables': '🥦',
}
