import { calculateOrder, createComplianceExample, createInvoiceDraft, createCreditNoteDraft } from '../src/compliance';
const {config,order,details}=createComplianceExample('JP');
const quote=calculateOrder(config,order);
const invoice=createInvoiceDraft(config,order,details);
if(quote.status!=='ready'||invoice.status!=='ready')throw Error('Browser financial calculation failed');
const credit=createCreditNoteDraft(invoice.value,{number:'C1',date:order.date,reason:'Browser fixture',review:config.business.review!,lines:[{lineId:'item-1',quantity:1}]});
if(credit.status!=='ready')throw Error('Browser credit failed');
document.querySelector('#result')!.textContent=JSON.stringify({gross:quote.value.gross,credit:credit.value.gross});
