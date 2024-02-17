import {
  IDiscount,
  Dosing,
  Amount,
  DosingCostCalculationData } from "@protoplan/types";



export async function calculateCostsAndRepurchases<
  T extends Partial<DosingCostCalculationData & { priority: number }>>(
  dosings: T[],
  retrieveExchangeRate: (fromCurrencyCode: string, toCurrencyCode: string) => Promise<number>)
{
  const dosingsWithListings = dosings
    .reduce((ds, d1) =>
    {
      const dWithListing = getDosingWithListing(d1);
      if(!dWithListing)
        return ds;

      return ds.concat(dWithListing);
    }, <(T & DosingCostCalculationData)[]>[]);

  const dosingsWithCosts = await Promise.all(dosings.map(async dosing =>
  {
    const dosingWithListing = getDosingWithListing(dosing);
    if(!dosingWithListing)
    {
      return ({
        ...dosing,
        productsPerMonth: undefined,
        listingsPerMonth: undefined,
        repurchase: undefined,
        costPerMonth: undefined,
        maxListingsPerOrder: undefined,
        ordersPerMonth: undefined,
        feesPerMonth: undefined,
        exchangeRate: undefined,
        priceWithTax: undefined,
        discountedPrice: undefined });
    }

    // productsPerMonth represents the total amount required over a month for this row's dosage.
    const productsPerMonth = await calculateProductsPerMonth(dosingWithListing);

    const bundleRows = dosingWithListing.bundleId ? dosingsWithListings
      .map(d1 => ({ ...d1, productsPerMonth }))
      .filter(r => (r.bundleId === dosingWithListing.bundleId)) : undefined;

    // Only show cost for highest priority row in bundle
    const rowsInBundle = bundleRows || [{ ...dosing, productsPerMonth }];
    const highestPriority = rowsInBundle.map(r => r.priority || 0).sort()[0];
    const highestPriorityBundleRow = Boolean(rowsInBundle.find(r => r.priority === highestPriority));

    // Listings per month determined by highest amount of product required out of the bundle
    const listingsPerMonth = Math.max(...rowsInBundle.map(r => productsPerMonth / (r.quantity || 1)));

    return await calculateCostAndRepurchase(
      { ...dosingWithListing, listingsPerMonth } ,
      retrieveExchangeRate,
      highestPriorityBundleRow);
  }));

  return dosingsWithCosts;
}

function getDosingWithListing<T extends Partial<DosingCostCalculationData>>(dosing: T)
{
  if(
    !dosing.listingId ||
    !dosing.productId ||
    dosing.dose === undefined ||
    dosing.doseUnitId === undefined ||
    dosing.dosesPerDay === undefined ||
    dosing.daysPerMonth === undefined ||
    !dosing.factor ||
    !dosing.amount ||
    !dosing.amountUnitId ||
    dosing.price === undefined ||
    !dosing.basketLimit ||
    !dosing.userCurrencyCode ||
    !dosing.listingCurrencyCode ||
    !dosing.vendorCountryId ||
    !dosing.userCountryId)
  {
    return;
  }

  return ({
    ...dosing,
    listingId: Number(dosing.listingId),
    productId: Number(dosing.productId),
    amount: Number(dosing.amount),
    amountUnitId: Number(dosing.amountUnitId),
    price: Number(dosing.price),
    factor: Number(dosing.factor),
    dose: Number(dosing.dose),
    doseUnitId: Number(dosing.doseUnitId),
    dosesPerDay: Number(dosing.dosesPerDay),
    daysPerMonth: Number(dosing.daysPerMonth),
    basketLimit: Number(dosing.basketLimit),
    vendorCountryId: Number(dosing.vendorCountryId),
    listingCurrencyCode: String(dosing.listingCurrencyCode),
    userCountryId: Number(dosing.userCountryId),
    userCurrencyCode: String(dosing.userCurrencyCode) });
}

export async function calculateCostAndRepurchase<
  T extends DosingCostCalculationData & Partial<IListingQuantity>>(
  dosing: T,
  retrieveExchangeRate: (fromCurrencyCode: string, toCurrencyCode: string) => Promise<number>,
  bundlePriorityProduct = true)
{
  // Represents the total amount required over a month for this row's dosage.
  const productsPerMonth = await calculateProductsPerMonth(dosing);

  // Listings per month determined by highest amount of product required out of the bundle
  const listingsPerMonth = dosing.listingsPerMonth || productsPerMonth;

  const dosingWithCostPerMonth = await calculateCostPerMonth({
      ...dosing,
      listingsPerMonth },
    retrieveExchangeRate);

  const dosingWithFeesPerMonth = await calculatePerOrderFeePerMonth({
    ...dosingWithCostPerMonth,
    listingsPerMonth });

  const repurchase = calculateRepurchase(listingsPerMonth);

  return {
    ...dosingWithFeesPerMonth,
    productsPerMonth,
    // Only show costs for highest priority row in bundle
    costPerMonth: bundlePriorityProduct ? dosingWithFeesPerMonth.costPerMonth : undefined,
    feesPerMonth: bundlePriorityProduct ? dosingWithFeesPerMonth.feesPerMonth : undefined,
    listingsPerMonth: bundlePriorityProduct ? listingsPerMonth : undefined,
    repurchase: bundlePriorityProduct ? repurchase : undefined };
}

export async function calculateProductsPerMonth(row: { productId: number, factor: number } & Amount & Dosing)
{
  return (
    row.dose *
    row.dosesPerDay *
    row.daysPerMonth *
    (row.factor || 1) /
    row.amount);
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
  deliveryPerListing?: number,
  userCurrencyCode: string,
  listingCurrencyCode: string,
  exchangeRate?: number,
  taxPercent?: number,
  baseTax?: number,
  salesTax?: number,
  vendorCountryId: number,
  userCountryId: number,
  discounts?: IDiscount[],
}

interface IListingQuantity
{
  listingsPerMonth: number
}

interface IBundleQuantity
{
  bundleId?: number,
  quantity: number,
  nBundleProducts: number,
  amountProportion?: number,
}

export async function calculateCostPerMonth<T>(
  listingQuantity: T & IListingCostCalculationData & Partial<IBundleQuantity> & IListingQuantity,
  retrieveExchangeRate: (fromCurrencyCode: string, toCurrencyCode: string) => Promise<number>)
{
  // Calculate listing price with per-listing taxes & exchange rate
  const listingWithPrice = await calculateListingCost(listingQuantity, retrieveExchangeRate);

  const costPerMonth = (listingWithPrice.priceWithTax * listingQuantity.listingsPerMonth) || 0;

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
  const baseTax = row.baseTax || 0;
  const taxPercent = row.taxPercent || 0;
  const userCurrencyCode = row.userCurrencyCode;
  const listingCurrencyCode = row.listingCurrencyCode;
  const exchangeRate = row.exchangeRate || await retrieveExchangeRate(listingCurrencyCode, userCurrencyCode);
  const salesTax = (
    row.vendorCountryId === 2 &&
    row.userCountryId === 2 &&
    listingCurrencyCode === "USD" &&
    row.salesTax) ? row.salesTax : 0;

  const discountedPrice = row.discounts ? row.discounts
    .filter(d => d.applied)
    .reduce((dp, d) => dp * (100 - d.savingPercent) / 100, price) : price;

  // Calculate listing price with per-listing taxes & exchange rate
  // Per-product delivery costs are also taxed
  const priceWithTax = (
    (discountedPrice + deliveryPerListing) * (1 + taxPercent / 100) * (1 + salesTax / 100) +
    (includeBaseTax ? baseTax : 0)) * exchangeRate;

  return { ...row, exchangeRate, discountedPrice, priceWithTax };
}






////////////// Per-Order Fees //////////////////////////////////////////////////////////////////////

type TOrderFeeCalculationData = {
  exchangeRate: number,
  quantity?: number,
  nBundleProducts?: number,
  deliveryPrice?: number,
  basketLimit?: number,
  priceWithTax: number,
  baseTax?: number,
  listingsPerMonth: number };

// Accounting for per-order charges (delivery, base tax, customs), would it be cheaper?
export async function calculatePerOrderFeePerMonth<T>(data: T & TOrderFeeCalculationData)
{
  const maxListingsPerOrder = data.basketLimit ? Math.floor(data.basketLimit / data.priceWithTax) || 1 : 1;
  const ordersPerMonth = data.listingsPerMonth / maxListingsPerOrder;

  // Delivery price shown in vendor's currency, base tax shown in user's currency
  // Fees per month calculated in user's currency
  const feesPerMonth =
    ((data.deliveryPrice || 0) * data.exchangeRate + (data.baseTax || 0)) *
    ordersPerMonth *
    (data.quantity || 1) /
    (data.nBundleProducts || 1);

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
