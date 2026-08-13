import {
  Bag,
  Bank,
  Bolt,
  Book,
  Car,
  Card,
  Cart,
  Exchange,
  Fork,
  Heart,
  House,
  Plane,
  Play,
  Shield,
  Tag,
  Vault,
  Wallet,
} from '../components/icons';

// Which icon a line of money gets, from whatever you happened to type in the
// category box. Keyword matching rather than a fixed list, so "Carrefour",
// "groceries" and "weekly shop" all find the trolley without anyone having to
// pick from a menu.
//
// The fallback is deliberate: an unrecognised category gets a plain tag, not a
// guess. A wrong icon is worse than a neutral one — it makes you doubt the row.
const RULES = [
  [Cart, ['grocer', 'supermarket', 'carrefour', 'lulu', 'spinneys', 'union coop', 'weekly shop']],
  [Fork, ['eat', 'restaurant', 'dining', 'cafe', 'coffee', 'takeaway', 'lunch', 'dinner']],
  [Car, ['fuel', 'petrol', 'salik', 'parking', 'taxi', 'uber', 'careem', 'transport', 'car ']],
  [House, ['rent', 'mortgage', 'home', 'housing', 'maintenance', 'cleaner']],
  [Book, ['school', 'tuition', 'education', 'nursery', 'books', 'course']],
  [Heart, ['health', 'pharmacy', 'doctor', 'dentist', 'clinic', 'medical', 'gym', 'fitness']],
  [Plane, ['flight', 'travel', 'holiday', 'hotel', 'visa', 'airline']],
  [Bolt, ['utilit', 'electric', 'water', 'dewa', 'internet', 'etisalat', 'du ', 'phone', 'mobile', 'gas']],
  [Play, ['netflix', 'spotify', 'stream', 'entertain', 'cinema', 'youtube', 'disney', 'game']],
  [Shield, ['insur', 'takaful', 'cover', 'warranty']],
  [Bag, ['shop', 'clothes', 'amazon', 'noon', 'gift', 'furniture']],
  [Wallet, ['salary', 'wage', 'income', 'payroll', 'bonus', 'allowance', 'pay ']],
];

const matches = (text, words) => words.some((word) => text.includes(word));

export function iconForCategory(category, { fallback = Tag } = {}) {
  const text = ` ${String(category || '').toLowerCase().trim()} `;
  if (text.trim() === '') return fallback;
  for (const [Icon, words] of RULES) {
    if (matches(text, words)) return Icon;
  }
  return fallback;
}

// An entry's icon comes from its category, except for the two kinds that are
// about movement rather than purpose: a transfer is a transfer whatever you
// called it, and money arriving with no category is income.
export function iconForEntry({ kind, category, description }) {
  if (kind === 'transfer_in' || kind === 'transfer_out') return Exchange;
  const named = iconForCategory(category || description, { fallback: null });
  if (named) return named;
  return kind === 'income' ? Wallet : Tag;
}

const ACCOUNT_ICONS = { current: Bank, savings: Vault, credit: Card };

export const iconForAccount = (type) => ACCOUNT_ICONS[type] || Bank;

// Income, a move between your own accounts, or money leaving: three tints,
// because the icon tile is the first thing the eye lands on in a list.
export function toneForEntry(kind) {
  if (kind === 'income') return 'in';
  // Both legs of a transfer are blue. Money you moved between your own
  // accounts is neither earned nor spent, and tinting the arriving side green
  // would make it read as income at a glance.
  if (kind === 'transfer_in' || kind === 'transfer_out') return 'move';
  return '';
}
