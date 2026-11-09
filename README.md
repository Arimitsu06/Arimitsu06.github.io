# Arimitsu06.github.io

Personal website. Plain Jekyll, so GitHub Pages builds it on push with no extra setup.

## Editing

| What | Where |
| --- | --- |
| Name, tagline, location, about text, facts, email, social links | `_config.yml` |
| Research (`/research/`, `selected: true` also shows on home) | `_data/research.yml`, intro text in `research.html` |
| Projects (`/projects/`, `selected: true` also shows on home) | `_data/projects.yml`, images in `assets/img/`, intro in `projects.html` |
| Experience / education | `_data/experience.yml` |
| Colors (day + night) and type | top of `assets/css/site.css` |
| Particles, day/night toggle, hover preview, scroll reveals | `assets/js/site.js` |

## Preview locally

```sh
bundle install
bundle exec jekyll serve --livereload
```

Then open http://localhost:4000.
