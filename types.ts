
export interface Product {
  id: string;
  name: string;
  description: string;
  price: string; // display price
  priceValue?: number; // numeric price for sorting/calculation
  category: string;
  imageUrl: string;
  stock?: number;
  tags?: string[];
}

export interface NavItem {
  label: string;
  href: string;
}

export interface Feature {
  title: string;
  description: string;
  icon: string;
}
