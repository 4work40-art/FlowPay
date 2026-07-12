// Единый источник правды по тарифам — лимиты и цены.
// enterprise: индивидуальные условия, оформляется не через самостоятельный чекаут.
const PLANS = {
  free:       { invoice_limit: 5,    price_kopecks: 0,       label: 'Бесплатный' },
  pro:        { invoice_limit: 50,   price_kopecks: 99000,   label: 'Профессиональный' },   // 990 ₽/мес
  business:   { invoice_limit: 300,  price_kopecks: 299000,  label: 'Бизнес' },              // 2990 ₽/мес
  enterprise: { invoice_limit: null, price_kopecks: null,    label: 'Корпоративный' },       // null = без лимита / по запросу
};

const PURCHASABLE_PLANS = ['pro', 'business'];

module.exports = { PLANS, PURCHASABLE_PLANS };
