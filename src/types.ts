
export interface TListing
{
  listingId: number,
  listingName: string,
  productId: number,
  bundleId: number | null,
  vendorId: number,
  vendorName: string,
  price: number,
  scrapedPrice: number,
  scrapeTime: Date,
  deliveryPrice: number | null,
  deliveryPerProduct?: number,
  userCountryId: number,
  userCurrencyCode: string,
  listingCurrencyCode: string,
  listingCurrencySymbol: string,
  exchangeRate: number,
  baseTax?: number,
  taxPercent?: number,
  taxBracketEnd?: number,
  priceWithTax: number,
  listingUrl: string,
  userId: number,
}

export type TListings = TListing[];

type TListingCosts =
{
  listingId: number,
  productId: number,
  price: number,
  listingCurrencyCode: string,
  exchangeRate: number;
  deliveryPerProduct: number | null,
  deliveryPrice: number | null,
  bundleId: number | null,
  quantity: number,
  nBundleProducts: number,
  vendorCountryId: number,
  baseTax: number | null,
  taxPercent: number | null,
  taxBracketEnd: number | null,
  basketLimit: number | null,
  userCurrencyCode: string,
  userCountryId: number,
  cost: number,
}

export interface TProtocolRow extends TProtocolRowCosts
{
  productName: string,
  listingName: string,
  brandName: string,
  amountUnit: string,
  recDoseUnitId: number,
  formId: number,
  listingCurrencyCode: string,
  priority: number,
  vendorId: number,
  vendorName: string,
  scrapeTime: Date,
}

export type TProtocol = TProtocolRow[]

export interface TProtocolRowCosts extends TListingCosts
{
  protocolId: number,
  dose: number,
  doseUnitId: number,
  amount: number,
  amountUnitId: number,
  dosesPerDay: number,
  daysPerMonth: number,
  productsPerMonth: number,
  listingsPerMonth: number,
  repurchase: number,
  costPerMonth: number,
  feesPerMonth: number
}
