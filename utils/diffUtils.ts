export interface DiffResult {
    type: 'equal' | 'added' | 'removed';
    value: string;
}

export const diffWords = (oldStr: string, newStr: string): DiffResult[] => {
    const oldWords = oldStr.trim().split(/\s+/);
    const newWords = newStr.trim().split(/\s+/);

    // Simple LCS-based diff or just a basic index comparison?
    // Since we want to highlight specific changes in a sentence, a simple index comparison 
    // might fail if words are inserted/deleted and shift the rest.
    // Let's implement a basic LCS (Longest Common Subsequence) for better accuracy.

    const m = oldWords.length;
    const n = newWords.length;
    const dp: number[][] = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (oldWords[i - 1].toLowerCase() === newWords[j - 1].toLowerCase()) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    const result: DiffResult[] = [];
    let i = m;
    let j = n;

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oldWords[i - 1].toLowerCase() === newWords[j - 1].toLowerCase()) {
            result.unshift({ type: 'equal', value: oldWords[i - 1] });
            i--;
            j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            result.unshift({ type: 'added', value: newWords[j - 1] });
            j--;
        } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
            result.unshift({ type: 'removed', value: oldWords[i - 1] });
            i--;
        }
    }

    return result;
};
