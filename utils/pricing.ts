import { Product, Market } from '../types';
import * as Core from './pricingCore.js';

export const parsePriceString: (input: unknown) => number = Core.parsePriceString;

export const getNumericPrice: (
  product: Product | null | undefined,
  market?: Market
) => number | null = (product, market = 'lk') => Core.getNumericPrice(product, market);

export const hasPriceForMarket: (
  product: Product | null | undefined,
  market?: Market
) => boolean = (product, market = 'lk') => Core.hasPriceForMarket(product, market);

export const formatPrice: (
  value: number | string | null | undefined,
  market?: Market
) => string = (value, market = 'lk') => Core.formatPrice(value, market);

export const getMarketCurrency: (market: Market) => {
  code: string;
  symbol: string;
  label: string;
  regionName: string;
} = Core.getMarketCurrency;

export const calculateLineTotal: (
  product: Product,
  qty: number,
  market?: Market
) => number | null = (product, qty, market = 'lk') => Core.calculateLineTotal(product, qty, market);

export const calculateSubtotal: (
  items: { product: Product; qty: number }[],
  market?: Market
) => number = (items, market = 'lk') => Core.calculateSubtotal(items, market);
