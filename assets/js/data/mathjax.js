// ---
// layout: compress
// # WARNING: Don't use '//' to comment out code, use '{% comment %}' and '{% endcomment %}' instead.
// ---

// {%- comment -%}
//   See: <https://docs.mathjax.org/en/latest/options/input/tex.html#tex-options>
// {%- endcomment -%}

// MathJax = {
//   tex: {
//     {%- comment -%} start/end delimiter pairs for in-line math {%- endcomment -%}
//     inlineMath: [
//       ['$', '$'],
//       ['\\(', '\\)']
//     ],
//     {%- comment -%} start/end delimiter pairs for display math {%- endcomment -%}
//     displayMath: [
//       ['$$', '$$'],
//       ['\\[', '\\]']
//     ],
//     {%- comment -%} equation numbering {%- endcomment -%}
//     tags: 'ams'
//   }
// };
---
layout: compress
# WARNING: Don't use '//' to comment out code, use '{% comment %}' and '{% endcomment %}' instead.
---

{%- comment -%}
  See: <https://docs.mathjax.org/en/latest/options/input/tex.html#tex-options>
{%- endcomment -%}

MathJax = {
  loader: { load: ['[tex]/physics',] },
  tex: {
    inlineMath: [
      ['$', '$'],
      ['\\(', '\\)']
    ],
    displayMath: [
      ['$$', '$$'],
      ['\\[', '\\]']
    ],
    packages: {'[+]': ['physics']},
    tags: 'ams',
    macros: {
        'e': '\\mathrm{e}',
        'i': '\\mathrm{i}',
        'RR': '\\mathbb{R}',
        'ZZ': '\\mathbb{Z}',
        'QQ': '\\mathbb{Q}',
      },
  },
  svg: { fontCache: 'global'},
};