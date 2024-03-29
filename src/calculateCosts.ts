import {
  TDosingCostCalculationData,
  IDiscount,
  Dosing,
  Amount,
  ListingCostCalculationData } from "@protoplan/types";
import Units from "@protoplan/unit-utils/lib/Units";


export async function calculateCostsAndRepurchases<T extends Partial<TDosingCostCalculationData>>(
  dosings: T[],
  units: Units,
  retrieveExchangeRate: (fromCurrencyCode: string, toCurrencyCode: string) => Promise<number>)
{
  const dosingsWithCosts = await Promise.all(dosings.map(async d =>
  {
    if(
      d.dose === undefined ||
      d.doseUnitId === undefined ||
      d.dosesPerDay === undefined ||
      d.daysPerMonth === undefined ||
      d.productId === undefined ||
      d.quantity === undefined ||
      d.amount === undefined ||
      d.amountUnitId === undefined ||
      d.listingId === undefined ||
      d.price === undefined ||
      d.discountedPrice === undefined ||
      d.deliveryPrice === undefined ||
      d.userCurrencyCode === undefined ||
      d.listingCurrencyCode === undefined ||
      d.taxPercent === undefined ||
      d.baseTax === undefined ||
      d.salesTax === undefined ||
      d.vendorCountryId === undefined ||
      d.basketLimit === undefined ||
      d.userCountryId === undefined ||
      d.nBundleProducts === undefined)
    {
      return {
        ...d,
        productsPerMonth: undefined,
        listingsPerMonth: undefined,
        repurchase: undefined,
        costPerMonth: undefined,
        maxListingsPerOrder: undefined,
        ordersPerMonth: undefined,
        feesPerMonth: undefined,
        exchangeRate: undefined,
        discountedPrice: undefined,
        priceWithTax: undefined };
    }

    // productsPerMonth represents the total amount required over a month for this row's dosage.
    const productsPerMonth = calculateProductsPerMonth({ ...d as T & TDosingCostCalculationData }, units);

    const bundleRows = d.bundleId ?
      dosings.map(d => ({ ...d, productsPerMonth })).filter(r => (r.bundleId === d.bundleId)) :
      [{ ...d, productsPerMonth }];

    // totalProductsPerMonth represents the total amount to cover all dosings of a bundle product
    // (required in case bundle product is split across multiple protocol rows for multiple dosing strategies)
    const totalProductsPerMonth = (productId: number) => bundleRows
      .filter(r => r.productId === productId)
      .reduce((pTot, br) => pTot + Number(br.productsPerMonth), 0);

    // Proportion of product in this row vs. across all rows
    const amountProportion = productsPerMonth / totalProductsPerMonth(d.productId) // of bundle product

    // Listings per month determined by highest amount of product required out of the bundle
    const listingsPerMonth = Math.max(...bundleRows.map(r => productsPerMonth / Number(r.quantity)));

    const dosingWithCostPerMonth = await calculateCostPerMonth({
        ...d as T & ListingCostCalculationData,
        listingsPerMonth,
        amountProportion },
      retrieveExchangeRate);

    const dosingWithFeesPerMonth = await calculatePerOrderFeePerMonth({
      ...dosingWithCostPerMonth,
      listingsPerMonth, });

    const repurchase = calculateRepurchase(listingsPerMonth);

    return { ...dosingWithFeesPerMonth, productsPerMonth, listingsPerMonth, repurchase };
  }));

  return dosingsWithCosts;
}

export function calculateProductsPerMonth(row: { productId: number } & Amount & Dosing, units: Units)
{
  const amount = Number(row.amount);
  const dose = Number(row.dose);
  const dosesPerDay = Number(row.dosesPerDay);
  const daysPerMonth = Number(row.daysPerMonth);
  const unitConversionFactor = units.getFactor(row.doseUnitId, row.amountUnitId, row.productId);
  if(!unitConversionFactor)
  {
    console.error("calculateProductsPerMonth: no unit conversion factor found " +
      "fromUnitId", row.doseUnitId,
      "toUnitId", row.amountUnitId)
  }

  return (
    dose *
    dosesPerDay *
    daysPerMonth *
    (unitConversionFactor || 1) /
    amount);
}

function calculateRepurchase(listingsPerMonth: number)
{
  const avgDaysPerMonth = 365.24 / 12;

  return (avgDaysPerMonth / listingsPerMonth);
}

interface IListingCostCalculationData
{
  listingId: number,
  price: number,
  deliveryPerListing: number | null,
  userCurrencyCode: string,
  listingCurrencyCode: string,
  exchangeRate?: number,
  taxPercent: number,
  baseTax: number,
  salesTax: number,
  vendorCountryId: number,
  userCountryId: number,
  discounts: IDiscount[],
}

interface IListingQuantity
{
  listingsPerMonth: number
}

interface IBundleQuantity
{
  bundleId: number | null,
  quantity: number,
  nBundleProducts: number,
  amountProportion?: number,
}

export async function calculateCostPerMonth<T>(
  listingQuantity: T & IListingCostCalculationData & IBundleQuantity & IListingQuantity,
  retrieveExchangeRate: (fromCurrencyCode: string, toCurrencyCode: string) => Promise<number>)
{
  // Calculate listing price with per-listing taxes & exchange rate
  const listingWithPrice = await calculateListingCost(listingQuantity, retrieveExchangeRate);

  let costPerMonth = (listingWithPrice.priceWithTax * listingQuantity.listingsPerMonth) || 0;

  // Apportion costPerMonth by:
  //   - quantity of product in bundle
  //   - the dose proportion of a bundle product in this row, where it is split across multiple rows
  //     (for different dosing dtrategies)
  if(listingQuantity.bundleId)
    costPerMonth *= listingQuantity.quantity * (listingQuantity.amountProportion || 1) / listingQuantity.nBundleProducts;

  return { ...listingWithPrice, costPerMonth };
}

export async function calculateListingCost<T>(
  row: T & IListingCostCalculationData,
  retrieveExchangeRate: (fromCurrencyCode: string, toCurrencyCode: string) => Promise<number>,
  includeBaseTax = false)
{
  const price = row.price;
  // Amazon - shown on listing page in vendor's currency
  const deliveryPerListing = row.deliveryPerListing || 0;
  const userCurrencyCode = row.userCurrencyCode;
  const listingCurrencyCode = row.listingCurrencyCode;

  const exchangeRate = row.exchangeRate || await retrieveExchangeRate(listingCurrencyCode, userCurrencyCode);
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

  return { ...row, exchangeRate, discountedPrice, priceWithTax };
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

  return { ...data, maxListingsPerOrder, ordersPerMonth, feesPerMonth };
}

export function sortDosings(dosings: { priority: number }[])
{
  return dosings.map(r => ({ ...r })).sort((a, b) => a.priority - b.priority);
}




/////// Total Costs ///////////////



export async function calculateTotalCosts(rows: { costPerMonth?: number, feesPerMonth?: number }[])
{
  const costPerMonth = rows.reduce((cost, row) => cost += row.costPerMonth || 0, 0);
  const feesPerMonth = rows.reduce((fees, row) => fees += row.feesPerMonth || 0, 0);

  return { costPerMonth, feesPerMonth };
}
