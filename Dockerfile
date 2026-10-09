FROM python:3.12-slim
WORKDIR /app
COPY resolver/requirements.txt ./resolver/requirements.txt
RUN pip install --no-cache-dir -r resolver/requirements.txt
COPY resolver/ ./resolver/
RUN useradd --system --uid 10001 --create-home appuser
USER appuser
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080
EXPOSE 8080
CMD ["python", "-m", "resolver.app"]