// Function to generate a random ad
function generateRandomAd(type) {
    const brand = adBrands[Math.floor(Math.random() * adBrands.length)];
    const headline = adHeadlines[Math.floor(Math.random() * adHeadlines.length)];
    const desc = adDescriptions[Math.floor(Math.random() * adDescriptions.length)];
    const cta = adCTAs[Math.floor(Math.random() * adCTAs.length)];
    const color = adColors[Math.floor(Math.random() * adColors.length)];
    
    // --- NEW: Generate Google Search URL based on Ad Keywords ---
    const searchKeywords = `${brand} ${headline}`;
    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(searchKeywords)}`;

    // Generate a consistent but realistic placeholder image based on the brand
    const imgSeed = brand.length + headline.length;
    const imageUrl = `https://picsum.photos/seed/${imgSeed}/400/300`;

    // Google AdSense UI Overlay (AdChoices & Close button)
    const adChoicesUI = `
        <div class="mock-ad-choices" onclick="event.preventDefault();">
            <span class="mock-ad-badge">Ad</span>
            <span class="mock-ad-close">×</span>
            <div class="mock-ad-triangle"></div>
        </div>
    `;

    if (type === 'banner') {
        // TOP BANNER - Now an <a> tag opening Google in a new tab
        return `
            <a href="${googleUrl}" target="_blank" class="mock-ad-container banner-ad mb-4 w-100 d-block text-decoration-none">
                ${adChoicesUI}
                <div class="d-flex align-items-center h-100 p-2">
                    <img src="${imageUrl}" class="mock-ad-img-banner rounded" alt="${brand}">
                    <div class="mock-ad-text text-start mx-3 flex-grow-1">
                        <div class="mock-ad-brand">${brand}</div>
                        <h5 class="mock-ad-headline mb-1">${headline}</h5>
                        <p class="mock-ad-desc d-none d-md-block mb-0">${desc}</p>
                    </div>
                    <button class="btn btn-sm mock-ad-btn text-white px-4" style="background-color: ${color};">${cta}</button>
                </div>
            </a>
        `;
    } else {
        // RIGHT SIDEBAR - Now an <a> tag opening Google in a new tab
        return `
            <a href="${googleUrl}" target="_blank" class="mock-ad-container sidebar-ad sticky-top d-block text-decoration-none" style="top: 20px;">
                ${adChoicesUI}
                <div class="p-3 d-flex flex-column h-100 text-center">
                    <div class="mock-ad-brand mb-2">${brand}</div>
                    <img src="${imageUrl}" class="mock-ad-img-sidebar rounded mb-3 w-100" alt="${brand}">
                    <h5 class="mock-ad-headline mb-2">${headline}</h5>
                    <p class="mock-ad-desc flex-grow-1 text-muted">${desc}</p>
                    <button class="btn w-100 mock-ad-btn text-white mt-auto" style="background-color: ${color}; pointer-events: none;">${cta}</button>
                </div>
            </a>
        `;
    }
}
