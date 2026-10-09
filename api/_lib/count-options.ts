// Exact and inclusive-tail quotes share one simulated count distribution.
export function countOptions(probabilities: number[], minimum: number) {
  return probabilities.flatMap((probability, count) =>
    count < minimum
      ? []
      : [
          { count, side: String(count), probability, atLeast: false },
          ...(count === 0
            ? []
            : [
                {
                  count,
                  side: `${count}+`,
                  probability: probabilities
                    .slice(count)
                    .reduce((sum, p) => sum + p, 0),
                  atLeast: true,
                },
              ]),
        ],
  );
}
