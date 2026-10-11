/**
 * Treble (G) clef as a vector path, so editor, PDF and HTML export draw the same
 * shape regardless of installed fonts. Outline of the capital "G" of DejaVu Serif
 * (free licence), scaled so it spans exactly the staff lines 3 and 1 from the
 * bottom (y = 60 .. 80, i.e. it wraps the second line from the bottom, where the
 * G is). It starts at x = 8 (print edition: the G sits ~3.9 pt inside the staff
 * start). Width: 17.6 units.
 */
export const G_CLEF_PATH = 'M23.44 66.10Q22.99 63.69 21.55 62.53Q20.12 61.38 17.56 61.38Q14.23 61.38 12.59 63.52Q10.95 65.66 10.95 70.00Q10.95 74.25 12.64 76.43Q14.33 78.61 17.61 78.61Q19.07 78.61 20.40 78.25Q21.73 77.89 22.93 77.17V72.20H19.31V70.81H25.55V78.01Q23.84 79.00 21.86 79.50Q19.87 80.0 17.61 80.0Q13.25 80.0 10.62 77.26Q8.0 74.53 8.0 70.00Q8.0 65.43 10.63 62.71Q13.26 60.0 17.72 60.0Q19.37 60.0 21.13 60.38Q22.89 60.76 24.88 61.53V66.10Z';
export const G_CLEF_LEFT = 8;
export const G_CLEF_WIDTH = 17.6;
