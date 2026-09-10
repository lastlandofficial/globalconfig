# Source review and executable coverage

Initial profile research: 2026-09-09. These are selected engineering checks derived from the cited official material, not an exhaustive legal analysis. Review deadlines in the rule pack are maintenance policy. Product classifications, rates, registration and applicability are supplied by the business.

| Requirement | Source and implemented behavior |
| --- | --- |
| India parties / number / items / totals | [CBIC Rule 46](https://taxinformation.cbic.gov.in/content-page/explore-rules/1000136/1000001): checks selected supplier/recipient fields, number characters/length, classification/unit presence, and reconciled amounts. Code length applicability and actual classification remain reviewed inputs. |
| India place of supply | [CBIC circular 90/09/2019-GST](https://cbic-gst.gov.in/pdf/circular-cgst-90.pdf): requires supplied place-of-supply information for the selected inter-state invoice case. No sourcing inference is performed. |
| India external authorization | [Rule 46](https://taxinformation.cbic.gov.in/content-page/explore-rules/1000136/1000001) and [GSTN e-invoice overview](https://tutorial.gst.gov.in/downloads/news/pamphlet_e_invoice_overview_updated_on_17_08_2023_approved_final.pdf): keeps applicability, signature and IRP evidence explicit. No live registration or QR/signature verification. Notification-specific declarations are caller supplied. |
| Japan invoice particulars | [NTA No. 6625](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6625.htm): issuer registration syntax, transaction identity, rate-grouped amounts and reduced-rate labels for the ordinary selected qualified-invoice profile. |
| Japan rounding | [NTA No. 6371](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6371.htm): round once per invoice tax-rate group, then allocate to lines. No line-by-line tax rounding followed by summation. |
| California rate decision | [CDTFA Know Your Rate](https://cdtfa.ca.gov/taxes-and-fees/know-your-rate.htm): requires an exact reviewed jurisdiction/rate decision. This source cannot establish rates, nexus, or taxability for other US states. |

The CBIC portal intermittently failed direct retrieval during research; the indexed official Rule 46 text and official circular were used to cross-check the selected fields. An unavailable document is reported as unavailable by `sources check`, not accepted as current. The Indian profile intentionally does not certify all Rule 46 particulars/exceptions or all subsequent notifications.

Financial credits preserve the original invoice's allocated amounts. They are not presented as complete Indian Rule 53 or Japanese qualified-return-invoice implementations. A credit's legal status stays `review-required`; full document issuance and return adjustments remain separate, reviewed work. Relevant starting points are [CBIC Rule 53](https://taxinformation.cbic.gov.in/content-page/explore-rules/1000144/1000001) and [NTA No. 6359](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6359.htm).

No legal source text is bundled. The package stores URLs, requirement identifiers, review metadata and engineering interpretations. The source monitor records content digests only, does not send application transactions to government sites, and never updates production rules automatically.
