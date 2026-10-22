'use strict';

(function () {
  const cardsContainer = document.getElementById('cards');
  const searchBox = document.getElementById('search-box');
  const searchInput = document.getElementById('search-input');
  const noMatch = document.getElementById('no-match');
  const error = document.getElementById('error');

  const entries = [];
  let loaded = false;

  function buildCard(release) {
    const version = release && release.version !== undefined ? String(release.version) : '';
    const date = release && release.date !== undefined ? String(release.date) : '';
    const notes = release && Array.isArray(release.notes) ? release.notes : [];

    const card = document.createElement('article');
    card.className = 'card';

    const heading = document.createElement('h2');
    heading.className = 'card-version';
    heading.textContent = version;
    card.appendChild(heading);

    const dateParagraph = document.createElement('p');
    dateParagraph.className = 'card-date';
    const time = document.createElement('time');
    if (date) {
      time.setAttribute('datetime', date);
    }
    time.textContent = date;
    dateParagraph.appendChild(time);
    card.appendChild(dateParagraph);

    const list = document.createElement('ul');
    list.className = 'card-notes';
    notes.forEach(function (note) {
      const item = document.createElement('li');
      item.textContent = note === null || note === undefined ? '' : String(note);
      list.appendChild(item);
    });
    card.appendChild(list);

    const text = (version + ' ' + notes.join(' ')).toLowerCase();
    return { element: card, text: text };
  }

  function applyFilter() {
    if (!loaded) {
      return;
    }
    const query = searchInput.value.trim().toLowerCase();
    let visible = 0;
    entries.forEach(function (entry) {
      const isMatch = query === '' || entry.text.indexOf(query) !== -1;
      entry.element.hidden = !isMatch;
      if (isMatch) {
        visible += 1;
      }
    });
    noMatch.hidden = !(query !== '' && visible === 0);
  }

  searchInput.addEventListener('input', applyFilter);

  (async function () {
    try {
      const response = await fetch('../data/releases.json');
      if (!response.ok) {
        throw new Error('Request failed with status ' + response.status);
      }
      const releases = await response.json();
      if (!Array.isArray(releases)) {
        throw new Error('Expected an array of releases');
      }
      const fragment = document.createDocumentFragment();
      releases.forEach(function (release) {
        const entry = buildCard(release);
        entries.push(entry);
        fragment.appendChild(entry.element);
      });
      cardsContainer.appendChild(fragment);
      loaded = true;
      applyFilter();
    } catch (err) {
      searchBox.hidden = true;
      cardsContainer.hidden = true;
      noMatch.hidden = true;
      error.hidden = false;
    }
  })();
})();
