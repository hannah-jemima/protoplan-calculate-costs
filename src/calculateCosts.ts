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
    const dosingWithProduct = getDosingWithProduct(dosing);
    const dosingWithListing = dosingWithProduct ? getDosingWithListing(dosingWithProduct) : undefined;
    if(!dosingWithListing)
    {
      const productsPerMonth = dosingWithProduct ? await calculateProductsPerMonth(dosingWithProduct) : undefined;

      return ({
        ...dosing,
        productsPerMonth,
        listingsPerMonth: undefined,
        repurchase: productsPerMonth ? calculateRepurchase(productsPerMonth) : undefined,
        costPerMonthWithFees: undefined,
        costPerMonthWithoutFees: undefined,
        maxListingsPerOrder: undefined,
        ordersPerMonth: undefined,
        exchangeRate: undefined,
        priceWithFees: undefined,
        priceWithoutFees: undefined,
        discountedPrice: undefined });
    }

    const bundleRows = dosingWithListing.bundleId ?
      await Promise.all(dosingsWithListings
        .filter(r => (r.bundleId === dosingWithListing.bundleId))
        .map(async d1 => ({ ...d1, productsPerMonth: await calculateProductsPerMonth(d1) }))) :
      [{ ...dosing, productsPerMonth: await calculateProductsPerMonth(dosingWithListing) }];

    // Only show cost for highest priority row in bundle
    const highestPriority = bundleRows.map(r => r.priority || 0).sort()[0];
    const highestPriorityBundleRow = dosing.priority === highestPriority;

    // Listings per month determined by highest amount of product required out of the bundle
    const listingsPerMonth = Math.max(...bundleRows.map(r => r.productsPerMonth / (r.quantity || 1)));

    return await calculateCostAndRepurchase(
      { ...dosingWithListing, listingsPerMonth } ,
      retrieveExchangeRate,
      highestPriorityBundleRow);
  }));

  return dosingsWithCosts;
}

function getDosingWithListing<T extends Partial<DosingCostCalculationData>>(dosing: T)
{
  const dosingWithProduct = getDosingWithProduct(dosing);

  if(
    !dosingWithProduct ||
    !dosingWithProduct.listingId ||
    dosingWithProduct.price === undefined ||
    !dosingWithProduct.basketLimit ||
    !dosingWithProduct.listingCurrencyCode ||
    !dosingWithProduct.vendorCountryId)
  {
    return;
  }

  return ({
    ...dosingWithProduct,
    listingId: Number(dosingWithProduct.listingId),
    price: Number(dosingWithProduct.price),
    basketLimit: Number(dosingWithProduct.basketLimit),
    vendorCountryId: Number(dosingWithProduct.vendorCountryId),
    listingCurrencyCode: String(dosingWithProduct.listingCurrencyCode),
    baseTax: Number(dosingWithProduct.baseTax) });
}

function getDosingWithProduct<T extends Partial<DosingCostCalculationData>>(dosing: T)
{
  if(
    !dosing.productId ||
    dosing.dose === undefined ||
    dosing.doseUnitId === undefined ||
    dosing.dosesPerDay === undefined ||
    dosing.daysPerMonth === undefined ||
    !dosing.factor ||
    !dosing.amount ||
    !dosing.amountUnitId ||
    !dosing.userCurrencyCode ||
    !dosing.userCountryId)
  {
    return;
  }

  return ({
    ...dosing,
    productId: Number(dosing.productId),
    amount: Number(dosing.amount),
    amountUnitId: Number(dosing.amountUnitId),
    factor: Number(dosing.factor),
    dose: Number(dosing.dose),
    doseUnitId: Number(dosing.doseUnitId),
    dosesPerDay: Number(dosing.dosesPerDay),
    daysPerMonth: Number(dosing.daysPerMonth),
    userCountryId: Number(dosing.userCountryId),
    userCurrencyCode: String(dosing.userCurrencyCode),
    protocolCurrencyCode: String(dosing.protocolCurrencyCode || dosing.userCurrencyCode) });
}

export async function calculateCostAndRepurchase<
  T extends DosingCostCalculationData & Partial<ListingQuantity>>(
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

  const repurchase = calculateRepurchase(listingsPerMonth);

  return {
    ...dosingWithCostPerMonth,
    productsPerMonth,
    // Only show costs for highest priority row in bundle
    costPerMonthWithFees: bundlePriorityProduct ?
      dosingWithCostPerMonth.costPerMonthWithFees :
      undefined,
    costPerMonthWithoutFees: bundlePriorityProduct ?
      dosingWithCostPerMonth.costPerMonthWithoutFees :
      undefined,
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

interface ListingCostCalculationData
{
  listingId: number,
  price: number,
  deliveryPrice?: number,
  deliveryPerListing?: number,
  userCurrencyCode: string,
  protocolCurrencyCode?: string;
  listingCurrencyCode: string,
  exchangeRate?: number,
  taxPercent?: number,
  baseTax: number,
  salesTax?: number,
  vendorCountryId: number,
  userCountryId: number,
  discounts?: IDiscount[],
  basketLimit?: number
}

interface ListingQuantity
{
  listingsPerMonth: number
}

interface BundleQuantity
{
  bundleId?: number,
  quantity: number,
}

export async function calculateCostPerMonth<T>(
  listingQuantity: T & ListingCostCalculationData & Partial<BundleQuantity> & ListingQuantity,
  retrieveExchangeRate: (fromCurrencyCode: string, toCurrencyCode: string) => Promise<number>)
{
  // Calculate listing price with per-listing taxes & exchange rate
  const listingWithPrice = await calculateListingCostWithFees(
    listingQuantity,
    retrieveExchangeRate);

  const costPerMonthWithoutFees = (
    listingWithPrice.priceWithoutFees *
    listingQuantity.listingsPerMonth) || 0;

  const costPerMonthWithFees = (
    listingWithPrice.priceWithFees *
    listingQuantity.listingsPerMonth) || 0;

  return { ...listingWithPrice, costPerMonthWithoutFees, costPerMonthWithFees };
}

export async function calculateListingCostWithoutFees<T>(
  row: T & ListingCostCalculationData,
  retrieveExchangeRate: (fromCurrencyCode: string, toCurrencyCode: string) => Promise<number>)
{
  const price = row.price;
  const userOrProtocolCurrencyCode = row.protocolCurrencyCode || row.userCurrencyCode;
  const listingCurrencyCode = row.listingCurrencyCode;
  const exchangeRate =
    row.exchangeRate ||
    await retrieveExchangeRate(listingCurrencyCode, userOrProtocolCurrencyCode);

  const discountedPrice = row.discounts ? row.discounts
    .filter(d => d.applied)
    .reduce((dp, d) => dp * (100 - d.savingPercent) / 100, price) : price;

  // Calculate listing price with per-listing taxes & exchange rate
  // Per-product delivery costs are also taxed
  // Base tax shown in user's currency
  const priceWithoutFees = discountedPrice * exchangeRate;

  return { ...row, exchangeRate, discountedPrice, priceWithoutFees };
}

export async function calculateListingCostWithFees<T>(
  row0: T & ListingCostCalculationData & ListingQuantity,
    retrieveExchangeRate: (fromCurrencyCode: string, toCurrencyCode: string) => Promise<number>,
  includeBaseTax = true)
{
  const row = await calculateListingCostWithoutFees(row0, retrieveExchangeRate);

  // Amazon - shown on listing page in vendor's currency
  const deliveryPerListing = row.deliveryPerListing || 0;
  const taxPercent = row.taxPercent || 0;
  const listingCurrencyCode = row.listingCurrencyCode;
  const salesTax = (
    row.vendorCountryId === 2 &&
    row.userCountryId === 2 &&
    listingCurrencyCode === "USD" &&
    row.salesTax) ? row.salesTax : 0;

  const basketLimit =
    row.basketLimit ||
    (250 * await retrieveExchangeRate("GBP", row.listingCurrencyCode));
  const maxListingsPerOrder = Math.floor(basketLimit / row.price);
  const ordersPerMonth = row.listingsPerMonth / maxListingsPerOrder;

  // Delivery price shown in vendor's currency, base tax shown in user's currency
  // Fees per month calculated in user's currency
  const baseTax = row.baseTax ? row.baseTax * await retrieveExchangeRate(
    row.userCurrencyCode,
    row.protocolCurrencyCode || row.userCurrencyCode) : 0;

  const orderFeesPerMonth = ((row.deliveryPrice || 0) * row.exchangeRate + baseTax) * ordersPerMonth;

  // Calculate listing price with per-listing taxes & exchange rate
  // Per-product delivery costs are also taxed
  // Base tax shown in user's currency
  const priceWithFees = (
    (row.priceWithoutFees + deliveryPerListing * row.exchangeRate) *
    (1 + taxPercent / 100) *
    (1 + salesTax / 100))  + (includeBaseTax ? baseTax : 0) + orderFeesPerMonth;

  return { ...row, priceWithFees, maxListingsPerOrder, ordersPerMonth, orderFeesPerMonth };
}



/////// Total Costs ///////////////


export async function calculateTotalCostsPerMonth(rows: {
  costPerMonthWithFees?: number,
  costPerMonthWithoutFees?: number }[])
{
  const costPerMonthWithFees = rows.reduce((cost, row) => cost += row.costPerMonthWithFees || 0, 0);
  const costPerMonthWithoutFees = rows.reduce((cost, row) => cost += row.costPerMonthWithoutFees || 0, 0);

  return { costPerMonthWithFees, costPerMonthWithoutFees };
}
