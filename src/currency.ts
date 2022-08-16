/* eslint-disable @typescript-eslint/ban-ts-comment */

import { exchangeRates } from "exchange-rates-api";

export async function retrieveExchangeRate(fromCurrencyCode: string, toCurrencyCode: string)
{
  if(fromCurrencyCode === toCurrencyCode)
    return 1;

  try
  {
    return Number(exchangeRates()
      // @ts-ignore
      .setApiBaseUrl('https://api.exchangerate.host')
      .latest()
      .base(fromCurrencyCode)
      .fetch()
      .then((rates: any) => rates[toCurrencyCode]));
  }
  catch(err)
  {
    console.log(err);
    return 1;
  }
}
