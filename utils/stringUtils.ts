/**
 * Normalizes text for comparison by removing punctuation and converting to lowercase.
 */
export const normalizeText = (text: string): string => {
    return text
        .toLowerCase()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
};

/**
 * Calculates the Levenshtein distance between two strings.
 * Returns a similarity score between 0 and 1 (1 being identical).
 */
export const calculateSimilarity = (s1: string, s2: string): number => {
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;

    if (longer.length === 0) {
        return 1.0;
    }

    const costs = new Array();
    for (let i = 0; i <= longer.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= shorter.length; j++) {
            if (i == 0) {
                costs[j] = j;
            } else {
                if (j > 0) {
                    let newValue = costs[j - 1];
                    if (longer.charAt(i - 1) != shorter.charAt(j - 1)) {
                        newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    }
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
        }
        if (i > 0) {
            costs[shorter.length] = lastValue;
        }
    }

    return (longer.length - costs[shorter.length]) / longer.length;
};
