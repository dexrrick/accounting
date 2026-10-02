# IRAS-first benchmark adjudications v1

These adjudications apply only to the versioned IRAS-first profiles. Historical fixtures and saved observations retain their original expectations.

## Mixed IFRS and Singapore reporting standards

The question explicitly names IFRS 16 and Singapore SFRS(I). `ACCOUNTING_STANDARDS` remains the governing authority and the only canonical accounting workstream. `IFRS_FOUNDATION` is accepted as contextual because the question names the IFRS standard. The v1 expected contextual-authority alternatives are `[]` or `[IFRS_FOUNDATION]`.

## Investment measurement comparison

`COMPARE` remains the expected operation. Population `COMPANY` or `UNKNOWN` is accepted because the general comparison does not identify a specific entity. The current phase does not claim comprehensive SFRS(I) topic coverage; missing topic mapping is recorded as a non-IRAS gap and does not fail the IRAS release metric. Semantic recognition, the accounting authority, and canonical accounting route remain checked.

## Separate unsupported accounting control

The fixed question asks for the general SFRS(I) 6 treatment of mineral exploration and evaluation expenditure. The current registry has no topic mapping for this request. The expected semantic route remains `ACCOUNTING_STANDARDS/ACCOUNTING`, with an explicit `NO_COVERAGE_TOPIC` and `INSUFFICIENT` result. The control is separate from the investment comparison and cannot pass if the issue disappears, routes into IRAS, or is reported `VERIFIED` without admitted evidence.
