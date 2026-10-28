export type Market = 'lk' | 'intl';

export interface Product {
  id: string;
  name: string;
  description: string;
  price: string; // display price in LKR (e.g. "Rs. 150")
  priceValue?: number; // numeric price in LKR
  exportPrice?: string; // display price in USD if configured (e.g. "$12.00")
  exportPriceValue?: number; // numeric export price in USD (e.g. 12.00)
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
