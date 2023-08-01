import {
  IUnitConversion,
  IUnit,
  IDosingCostCalculationData,
  IDiscount } from "@protoplan/types";
import { retrieveExchangeRate } from "@protoplan/exchange-rates";
import { getUnitConversionFactor } from "@protoplan/unit-utils";


export async function calculateCostsAndRepurchases<T extends IDosingCostCalculationData>(
  dosings: T[],
  units: IUnit[],
  unitConversions: IUnitConversion[],
  getExchangeRateFromDb: (fromCurrencyCode: string, toCurrencyCode: string) => Promise<number | null>,
  storeExchangeRate: (fromCurrencyCode: string, toCurrencyCode: string, exchangeRate: number) => Promise<void>)
{
  const dosingsWithProductsPerMonth = dosings.map(row =>
  {
    const productsPerMonth = calculateProductsPerMonth(row, units, unitConversions);

    return { ...row, productsPerMonth };
  });

  const dosingsWithCosts = await Promise.all(dosingsWithProductsPerMonth.map(async row =>
  {
    const bundleRows = row.bundleId ?
      dosingsWithProductsPerMonth.filter(r => (r.bundleId === row.bundleId)) :
      [row];

    // totalProductsPerMonth represents the total amount to cover all dosings of a bundle product
    // (required in case bundle product is split across multiple protocol rows for multiple dosing strategies)
    const totalProductsPerMonth = (productId: number) => bundleRows
      .filter(r => r.productId === productId)
      .reduce((pTot, br) => pTot + br.productsPerMonth, 0);

    // Proportion of product in this row vs. across all rows
    const amountProportion = row.productsPerMonth / totalProductsPerMonth(row.productId) // of bundle product

    // Listings per month determined by highest amount of product required out of the bundle
    const listingsPerMonth = Math.max(...bundleRows.map(r => row.productsPerMonth / r.quantity));

    const repurchase = calculateRepurchase(listingsPerMonth);

    const {
      exchangeRate,
      priceWithTax,
      costPerMonth } = await calculateCostPerMonth({
        ...row,
        listingsPerMonth,
        amountProportion },
        getExchangeRateFromDb,
        storeExchangeRate);

    const { maxListingsPerOrder, ordersPerMonth, feesPerMonth } = await calculatePerOrderFeePerMonth({
      ...row,
      exchangeRate,
      priceWithTax,
      listingsPerMonth,
      costPerMonth });

    return {
      // row.productsPerMonth represents the total amount required over a month for this row's dosage.
      ...row,
      listingsPerMonth,
      repurchase,
      exchangeRate,
      priceWithTax,
      costPerMonth,
      maxListingsPerOrder,
      ordersPerMonth,
      feesPerMonth };
  }));

  return dosingsWithCosts;
}

export function calculateProductsPerMonth(
  row: {
    productId: number,
    amount: number,
    amountUnitId: number,
    dosesPerDay: number,
    daysPerMonth: number,
    dose: number,
    doseUnitId: number },
  units: IUnit[],
  unitConversions: IUnitConversion[])
{
  const amount = Number(row.amount);
  const dose = Number(row.dose);
  const dosesPerDay = Number(row.dosesPerDay);
  const daysPerMonth = Number(row.daysPerMonth);
  const unitConversionFactor = getUnitConversionFactor(
    row.doseUnitId,
    row.amountUnitId,
    [row.productId],
    units,
    unitConversions);

  return (
    dose *
    dosesPerDay *
    daysPerMonth *
    unitConversionFactor /
    amount);
}

function calculateRepurchase(listingsPerMonth: number)
{
  const avgDaysPerMonth = 365.24 / 12;

  return (avgDaysPerMonth / listingsPerMonth);
}

export async function calculateCostPerMonth(
  row: {
    listingId: number,
    nBundleProducts: number,
    listingsPerMonth: number,
    bundleId: number | null,
    quantity: number,
    price: number,
    deliveryPerListing: number | null,
    userCurrencyCode: string,
    listingCurrencyCode: string,
    taxPercent: number,
    baseTax: number,
    salesTax: number,
    vendorCountryId: number,
    userCountryId: number,
    amountProportion?: number,
    discounts: IDiscount[] },
  getExchangeRateFromDb: (fromCurrencyCode: string, toCurrencyCode: string) => Promise<number | null>,
  storeExchangeRate: (fromCurrencyCode: string, toCurrencyCode: string, exchangeRate: number) => Promise<void>)
{
  // Calculate listing price with per-listing taxes & exchange rate
  const { exchangeRate, priceWithTax } = await calculateListingCost(row, getExchangeRateFromDb, storeExchangeRate);

  let costPerMonth = (priceWithTax * row.listingsPerMonth) || 0;

  // Apportion costPerMonth by:
  //   - quantity of product in bundle
  //   - the dose proportion of a bundle product in this row, where it is split across multiple rows
  //     (for different dosing dtrategies)
  if(row.bundleId)
    costPerMonth *= row.quantity * (row.amountProportion || 1) / row.nBundleProducts;

  return { exchangeRate: Number(exchangeRate), priceWithTax, costPerMonth };
}

export async function calculateListingCost(
  row: {
    listingId: number,
    price: number,
    deliveryPerListing: number | null,
    userCurrencyCode: string,
    listingCurrencyCode: string,
    taxPercent: number,
    baseTax: number,
    salesTax: number,
    vendorCountryId: number,
    userCountryId: number,
    discounts: IDiscount[] },
  getExchangeRateFromDb: (fromCurrencyCode: string, toCurrencyCode: string) => Promise<number | null>,
  storeExchangeRate: (fromCurrencyCode: string, toCurrencyCode: string, exchangeRate: number) => Promise<void>,
  includeBaseTax = false)
{
  const price = row.price;
  // Amazon - shown on listing page in vendor's currency
  const deliveryPerListing = row.deliveryPerListing || 0;
  const userCurrencyCode = row.userCurrencyCode;
  const listingCurrencyCode = row.listingCurrencyCode;

  const exchangeRate = await retrieveExchangeRate(
    listingCurrencyCode,
    userCurrencyCode,
    () => getExchangeRateFromDb(listingCurrencyCode, userCurrencyCode),
    (rate: number) => storeExchangeRate(listingCurrencyCode, userCurrencyCode, rate));
  const salesTax = (row.vendorCountryId === 2 && row.userCountryId === 2 && listingCurrencyCode === "USD") ?
    row.salesTax : 0;

  const discountedPrice = row.discounts
    .filter(d => d.applied)
    .reduce((dp, d) => dp * (100 - d.savingPercent) / 100, price);

  // Calculate listing price with per-listing taxes & exchange rate
  // Per-product delivery costs are also taxed
  const priceWithTax = (
    (discountedPrice + deliveryPerListing) * (1 + row.taxPercent / 100) * (1 + salesTax / 100) +
    (includeBaseTax ? row.baseTax : 0)) * exchangeRate;

  return { exchangeRate, discountedPrice, priceWithTax };
}






////////////// Per-Order Fees //////////////////////////////////////////////////////////////////////

type TOrderFeeCalculationData = {
  exchangeRate: number,
  quantity: number,
  nBundleProducts: number,
  deliveryPrice: number,
  basketLimit: number,
  priceWithTax: number,
  baseTax: number,
  listingsPerMonth: number };

// Accounting for per-order charges (delivery, base tax, customs), would it be cheaper?
export async function calculatePerOrderFeePerMonth<T>(data: T & TOrderFeeCalculationData)
{
  const maxListingsPerOrder = Math.floor(data.basketLimit / data.priceWithTax) || 1;
  const ordersPerMonth = data.listingsPerMonth / maxListingsPerOrder;

  // Delivery price shown in vendor's currency, base tax shown in user's currency
  // Fees per month calculated in user's currency
  const feesPerMonth =
    (Number(data.deliveryPrice) * data.exchangeRate + data.baseTax) *
    ordersPerMonth *
    data.quantity /
    data.nBundleProducts;

  return { maxListingsPerOrder, ordersPerMonth, feesPerMonth };
}

export function sortDosings(dosings: { priority: number }[])
{
  return dosings.map(r => ({ ...r })).sort((a, b) => a.priority - b.priority);
}




/////// Total Costs ///////////////



export async function calculateTotalCosts(rows: { costPerMonth: number, feesPerMonth: number }[])
{
  const costPerMonth = rows.reduce((cost, row) => cost += row.costPerMonth || 0, 0);
  const feesPerMonth = rows.reduce((fees, row) => fees += row.feesPerMonth || 0, 0);

  return { costPerMonth, feesPerMonth };
}
