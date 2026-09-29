import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value);
}

import { expandAbbreviations, formatProductTitle } from "../utils/abbreviations";

export { expandAbbreviations, formatProductTitle };

export function formatCapitalized(text?: string | null): string {
  if (!text) return '';
  return formatProductTitle(text);
}

