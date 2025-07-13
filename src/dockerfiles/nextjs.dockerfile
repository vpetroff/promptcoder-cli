# Next.js App Dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
COPY yarn.lock* ./
COPY pnpm-lock.yaml* ./

# Install dependencies based on available lock file
RUN if [ -f yarn.lock ]; then yarn install --frozen-lockfile; \
    elif [ -f pnpm-lock.yaml ]; then npm install -g pnpm && pnpm install --frozen-lockfile; \
    else npm ci; fi

# Copy application code
COPY . .

# Build the Next.js application
RUN if [ -f yarn.lock ]; then yarn build; \
    elif [ -f pnpm-lock.yaml ]; then pnpm build; \
    else npm run build; fi

# Expose port
EXPOSE 3000

# Start the Next.js application
CMD if [ -f yarn.lock ]; then yarn start; \
    elif [ -f pnpm-lock.yaml ]; then pnpm start; \
    else npm start; fi