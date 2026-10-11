import { flatten, flatMap, maxOf, compareNatural } from './utils';

describe('Utility Helpers (utils.ts)', () => {
    describe('flatten', () => {
        it('should return an empty array when given an empty nested array', () => {
            expect(flatten([])).toEqual([]);
        });

        it('should flatten a simple 2D array of numbers', () => {
            const nested = [[1, 2], [3], [4, 5]];
            expect(flatten(nested)).toEqual([1, 2, 3, 4, 5]);
        });

        it('should flatten a nested array of strings', () => {
            const nested = [['a', 'b'], ['c', 'd']];
            expect(flatten(nested)).toEqual(['a', 'b', 'c', 'd']);
        });
    });

    describe('flatMap', () => {
        it('should map and flatten values', () => {
            const input = [1, 2, 3];
            const duplicate = (n: number) => [n, n];
            expect(flatMap(input, duplicate)).toEqual([1, 1, 2, 2, 3, 3]);
        });

        it('should handle functions returning empty arrays', () => {
            const input = [1, 2, 3, 4];
            const filterEven = (n: number) => n % 2 === 0 ? [n] : [];
            expect(flatMap(input, filterEven)).toEqual([2, 4]);
        });
    });

    describe('maxOf', () => {
        it('should return undefined when given an empty array', () => {
            expect(maxOf([])).toBeUndefined();
        });

        it('should return the maximum value from a list of positive numbers', () => {
            expect(maxOf([1, 5, 3, 9, 2])).toBe(9);
        });

        it('should return the maximum value from a list containing negative numbers', () => {
            expect(maxOf([-10, -5, -2, -15])).toBe(-2);
        });

        it('should return the maximum value when list contains duplicates', () => {
            expect(maxOf([4, 7, 7, 1])).toBe(7);
        });
    });

    describe('compareNatural', () => {
        const sorted = (a: string[]) => [...a].sort(compareNatural);

        it('orders every part of an ID by its value, letters first', () => {
            expect(sorted(['Pa 10-1-1', 'Pa 2-1-1', 'Mo 1-10-1', 'Mo 1-2-1', 'Mo 1-1-10', 'Mo 1-1-2', 'Pa 1-1-1', 'Aa 20-1-1']))
                .toEqual(['Aa 20-1-1', 'Mo 1-1-2', 'Mo 1-1-10', 'Mo 1-2-1', 'Mo 1-10-1', 'Pa 1-1-1', 'Pa 2-1-1', 'Pa 10-1-1']);
        });

        it('ignores case and treats missing text as empty', () => {
            expect(compareNatural('a 1', 'A 1')).toBe(0);
            expect(compareNatural(undefined, 'A')).toBeLessThan(0);
            expect(compareNatural(null, '')).toBe(0);
        });
    });
});
