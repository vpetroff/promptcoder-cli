# Node.js Application Dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Copy all files to temp location, then move lock files if they exist
COPY . /tmp/src/
RUN if [ -f /tmp/src/package-lock.json ]; then cp /tmp/src/package-lock.json ./; fi
RUN if [ -f /tmp/src/yarn.lock ]; then cp /tmp/src/yarn.lock ./; fi
RUN if [ -f /tmp/src/pnpm-lock.yaml ]; then cp /tmp/src/pnpm-lock.yaml ./; fi

# Install dependencies based on available lock file
RUN if [ -f yarn.lock ]; then yarn install --frozen-lockfile; \
    elif [ -f pnpm-lock.yaml ]; then npm install -g pnpm && pnpm install --frozen-lockfile; \
    elif [ -f package-lock.json ]; then npm ci; \
    else npm install; fi

# Copy rest of application code from temp location
RUN cp -r /tmp/src/* ./ && rm -rf /tmp/src

# Build the application (if build script exists)
RUN if [ -f yarn.lock ] && yarn run --silent build --version > /dev/null 2>&1; then yarn build; \
    elif [ -f pnpm-lock.yaml ] && pnpm run build --help > /dev/null 2>&1; then pnpm build; \
    elif npm run build --silent > /dev/null 2>&1; then npm run build; \
    else echo "No build script found, skipping build step"; fi

# Expose port (default Node.js port)
EXPOSE 3000

# Start the application or keep container alive for CLI tools
CMD if [ -f package.json ] && grep -q '"bin"' package.json; then \
    echo "CLI tool detected - trying interactive mode or shell"; \
    if npm run start --silent -- --help 2>/dev/null | grep -q interactive; then \
      npm start -- interactive; \
    else \
      echo "Starting interactive shell - run 'npm start' to use the CLI"; \
      /bin/sh; \
    fi; \
  elif [ -f yarn.lock ]; then yarn start; \
  elif [ -f pnpm-lock.yaml ]; then pnpm start; \
  else npm start; fi