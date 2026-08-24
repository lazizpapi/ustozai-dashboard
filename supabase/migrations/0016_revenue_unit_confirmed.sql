-- The revenue unit, confirmed.
--
-- 0014 stored takings exactly as the payment API reported them and said so in
-- the column comment, because the unit was undocumented and dividing by a
-- guessed hundred would have been a hundredfold error in the most quotable
-- number in the company. The company has since confirmed it: Payme and Click
-- both report in tiyin, the hundredth of a som.
--
-- Nothing about the stored data changes. The rows are still the raw figures the
-- providers sent, and revenueSummary divides by a hundred on the way out, so a
-- revised understanding of the unit costs one query change rather than a
-- rewrite of every row ever collected. Only the comment was wrong, and a
-- comment telling the next reader not to scale a column that is now scaled is
-- worse than no comment at all.

comment on column revenue_daily.amount is
  'Tiyin, exactly as the payment API reports it. Payme and Click both report '
  'in the hundredth of a som; revenueSummary in src/lib/db/queries.ts converts '
  'to som on read. Store raw here, scale there.';
