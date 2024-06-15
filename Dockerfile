# Start with the Node.js Alpine image
FROM node:alpine

# Set the working directory
WORKDIR /app
COPY . /app
RUN rm -r /app/node_modules
RUN rm -r dist

RUN chmod 700 /app
# Copy the local package files to the container's workspace

# Install necessary packages
RUN apk add --update python3 make g++

# Install Go
RUN apk add --no-cache go
RUN apk add shadow util-linux

RUN adduser -D minimumGuy

# creating a group and adding the above user
RUN groupadd min
RUN usermod -a -G min minimumGuy
RUN chgrp min /app
RUN chmod g+rx /app



RUN touch /home/minimumGuy/main.go
RUN touch /home/minimumGuy/nice.json
RUN touch /home/minimumGuy/hello.py

# Set up Go environment variables
ENV GOPATH /go
ENV PATH $GOPATH/bin:/usr/local/go/bin:$PATH

# Install gopls
RUN go install golang.org/x/tools/gopls@latest

# Install PM2
RUN npm install -g pm2

# Install app dependencies
RUN npm install
RUN npx tsc


# Expose port 80
EXPOSE 80


# RUN pm2 start dist/python-lsp.js
# CMD ["pm2","start","/app/dist/python-lsp.js", "-c", "pm2", "logs"]
CMD ["node", "/app/dist/python-lsp.js"]
# Start the app
# CMD ["su", "minimumGuy", "-c", "pm2 start dist/python-lsp.js"]

# CMD ["pm2", "start", "/app/dist/python-lsp.js"]