// Сумма прописью для формы "Счёт на оплату" — стандартное требование
// печатной формы (напр. "Пятнадцать тысяч рублей 00 копеек"). Чистая
// функция, без внешних зависимостей.

const ONES = {
  m: ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'],
  f: ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'],
};
const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать',
  'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

// [ед.ч., 2-4, 5+, род ('m'|'f')]
const SCALE = [
  { forms: ['', '', ''], gender: 'm' },
  { forms: ['тысяча', 'тысячи', 'тысяч'], gender: 'f' },
  { forms: ['миллион', 'миллиона', 'миллионов'], gender: 'm' },
  { forms: ['миллиард', 'миллиарда', 'миллиардов'], gender: 'm' },
];

function pluralForm(n, forms) {
  const n100 = n % 100;
  const n10 = n % 10;
  if (n100 >= 11 && n100 <= 14) return forms[2];
  if (n10 === 1) return forms[0];
  if (n10 >= 2 && n10 <= 4) return forms[1];
  return forms[2];
}

function threeDigitsToWords(n, gender) {
  const words = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) words.push(HUNDREDS[hundreds]);
  if (rest >= 10 && rest <= 19) {
    words.push(TEENS[rest - 10]);
  } else {
    const tens = Math.floor(rest / 10);
    const ones = rest % 10;
    if (tens) words.push(TENS[tens]);
    if (ones) words.push(ONES[gender][ones]);
  }
  return words;
}

function integerToWords(n) {
  if (n === 0) return ['ноль'];
  const groups = [];
  let rem = n;
  while (rem > 0) { groups.push(rem % 1000); rem = Math.floor(rem / 1000); }

  const words = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    const scale = SCALE[i] || SCALE[SCALE.length - 1];
    words.push(...threeDigitsToWords(g, scale.gender));
    if (i > 0) words.push(pluralForm(g, scale.forms));
  }
  return words;
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

const RUB_FORMS = ['рубль', 'рубля', 'рублей'];
const KOP_FORMS = ['копейка', 'копейки', 'копеек'];

// amountKopecks -> "Пятнадцать тысяч рублей 00 копеек"
function amountToWordsRu(amountKopecks) {
  const rub = Math.floor(amountKopecks / 100);
  const kop = amountKopecks % 100;
  const rubWords = integerToWords(rub).join(' ');
  const rubForm = pluralForm(rub, RUB_FORMS);
  const kopForm = pluralForm(kop, KOP_FORMS);
  return `${capitalize(rubWords)} ${rubForm} ${String(kop).padStart(2, '0')} ${kopForm}`;
}

module.exports = { amountToWordsRu };
