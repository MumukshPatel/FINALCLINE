import type { AssumptionIssue, SaleEstimate, SaleEstimateInput, SaleScenario, ScenarioKind } from "./types";
import { calculateLoads, convertQuantity } from "./quantity";
import { calculateTransport } from "./transport";
import { finiteNumber, issue, MAX_MONEY, money, status } from "./validation";
import { decimal } from "./arithmetic";
import { calculateSellingExpenses } from "./selling";

export function calculateSaleScenarios(input: SaleEstimateInput): SaleEstimate {
  const quantity = convertQuantity(input.quantity);
  const loadResult = calculateLoads(quantity.value?.totalKg ?? null, input.payload);
  const transport = calculateTransport(input.transport, loadResult.value);
  const sharedIssues: AssumptionIssue[] = [
    ...quantity.missingAssumptions, ...loadResult.missingAssumptions, ...transport.missingAssumptions,
  ];
  const selling = calculateSellingExpenses(input.sellingExpenses, quantity.value, loadResult.value, transport.total);
  const sellingExpenses = selling.total;
  sharedIssues.push(...selling.missingAssumptions);
  if (typeof input.minimumPricePerQuintal === "number" && typeof input.modalPricePerQuintal === "number" &&
      input.minimumPricePerQuintal > input.modalPricePerQuintal) {
    sharedIssues.push(issue("prices", "Reported minimum price cannot exceed reported modal price."));
  }

  function scenario(kind: ScenarioKind, priceInput: number | null): { value: SaleScenario; issues: AssumptionIssue[] } {
    const issues = [...sharedIssues];
    const price = finiteNumber(priceInput, `${kind}.pricePerQuintal`, issues, true, MAX_MONEY);
    const gross = quantity.value !== null && price !== null
      ? money(decimal(quantity.value.quantityInQuintals).mul(price).toNumber(), `${kind}.grossSaleProceeds`, issues) : null;
    const net = gross !== null && transport.total !== null && sellingExpenses !== null && !issues.length
      ? money(decimal(gross).minus(transport.total).minus(sellingExpenses).toNumber(), `${kind}.estimatedNetSaleProceeds`, issues) : null;
    const totalDeductions = transport.total !== null && sellingExpenses !== null
      ? money(decimal(transport.total).plus(sellingExpenses).toNumber(), `${kind}.totalDeductions`, issues) : null;
    return {
      value: {
        kind, pricePerQuintal: price, grossSaleProceeds: gross,
        transportCost: transport.total, sellingExpenses, estimatedNetSaleProceeds: net, totalDeductions,
        status: status(issues),
      }, issues,
    };
  }
  const modal = scenario("reported-modal", input.modalPricePerQuintal);
  const minimum = scenario("reported-minimum", input.minimumPricePerQuintal);
  const missingAssumptions = [...new Map([...modal.issues, ...minimum.issues]
    .map((item) => [`${item.kind}:${item.field}:${item.message}`, item])).values()];
  return {
    quantity: quantity.value, loads: loadResult.value, transport, sellingExpenses,
    sellingExpenseBreakdown: selling.lines,
    scenarios: { reportedModal: modal.value, reportedMinimum: minimum.value },
    status: status(missingAssumptions), missingAssumptions,
  };
}
