const express = require('express');
const axios = require('axios');

const app = express();
const PORT = 3000;

// Your NewsAPI Key
const API_KEY = '5b69e4d348ad436ca832910872c7d663';

// Main Route (Handles both Home Page and Search)
app.get('/', async (req, res) => {
    const searchQuery = req.query.q || '';
    let apiUrl = '';
    let pageTitle = '';

    if (searchQuery) {
        // Search all news for the query
        apiUrl = `https://newsapi.org/v2/everything?q=${encodeURIComponent(searchQuery)}&pageSize=10&apiKey=${API_KEY}`;
        pageTitle = `Search Results for "${searchQuery}"`;
    } else {
        // Default: Top 10 Headlines in the US
        apiUrl = `https://newsapi.org/v2/top-headlines?country=us&pageSize=10&apiKey=${API_KEY}`;
        pageTitle = 'Top 10 Headlines';
    }

    try {
        const response = await axios.get(apiUrl);
        // Filter out articles removed by publishers
        const articles = response.data.articles.filter(article => article.title !== '[Removed]');
        
        // Render the HTML page directly
        res.send(generateHTML(articles, pageTitle, searchQuery));
    } catch (error) {
        console.error("Error fetching news:", error.message);
        res.send(generateHTML([], 'Error fetching news. Please try again later.', searchQuery));
    }
});

// Function to generate the HTML String
function generateHTML(articles, title, searchQuery) {
    let articlesHTML = '';

    if (articles.length > 0) {
        articlesHTML = articles.map(article => `
            <div class="col-md-6 col-lg-4 mb-4">
                <div class="card h-100 shadow-sm">
                    <img src="${article.urlToImage || 'https://via.placeholder.com/400x200?text=No+Image'}" 
                         class="card-img-top" alt="News Image" style="height: 200px; object-fit: cover;">
                    <div class="card-body d-flex flex-column">
                        <h5 class="card-title">${article.title}</h5>
                        <p class="card-text text-muted small">
                            By ${article.author || 'Unknown'} | ${new Date(article.publishedAt).toLocaleDateString()}
                        </p>
                        <p class="card-text">${article.description ? article.description.substring(0, 100) + '...' : 'No description available.'}</p>
                        <a href="${article.url}" target="_blank" class="btn btn-primary mt-auto">Read Full Article</a>
                    </div>
                </div>
            </div>
        `).join('');
    } else {
        articlesHTML = `<div class="col-12"><div class="alert alert-warning">No articles found. Try searching for something else!</div></div>`;
    }

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>News Blog</title>
        <!-- Bootstrap CSS -->
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    </head>
    <body class="bg-light">
        <!-- Navigation & Search Bar -->
        <nav class="navbar navbar-expand-lg navbar-dark bg-dark mb-4">
            <div class="container">
                <a class="navbar-brand" href="/">📰 Daily News Blog</a>
                <form class="d-flex" action="/" method="GET">
                    <input class="form-control me-2" type="search" name="q" placeholder="Search news..." value="${searchQuery}" required>
                    <button class="btn btn-outline-light" type="submit">Search</button>
                </form>
            </div>
        </nav>

        <!-- Main Content -->
        <div class="container">
            <h2 class="mb-4">${title}</h2>
            <div class="row">
                ${articlesHTML}
            </div>
        </div>
    </body>
    </html>
    `;
}

// Start Server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
