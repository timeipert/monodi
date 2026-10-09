/**
 * Treble (G) clef as a vector path, so editor, PDF and HTML export draw the same
 * shape regardless of installed fonts. Outline of the capital "G" of DejaVu Serif
 * (free licence), scaled so it spans exactly the staff lines 3 and 1 from the
 * bottom (y = 60 .. 80, i.e. it wraps the second line from the bottom, where the
 * G is) and starts at x = 3. Width: 17.6 units.
 */
export const G_CLEF_PATH = 'M18.44 66.10Q17.99 63.69 16.55 62.53Q15.12 61.38 12.56 61.38Q9.23 61.38 7.59 63.52Q5.95 65.66 5.95 70.00Q5.95 74.25 7.64 76.43Q9.33 78.61 12.61 78.61Q14.07 78.61 15.40 78.25Q16.73 77.89 17.93 77.17V72.20H14.31V70.81H20.55V78.01Q18.84 79.00 16.86 79.50Q14.87 80.0 12.61 80.0Q8.25 80.0 5.62 77.26Q3.0 74.53 3.0 70.00Q3.0 65.43 5.63 62.71Q8.26 60.0 12.72 60.0Q14.37 60.0 16.13 60.38Q17.89 60.76 19.88 61.53V66.10Z';
export const G_CLEF_WIDTH = 17.6;
